"""Delinea las cuencas aguas arriba de los puntos de salida en puntos.json.

Uso (fuera del paquete npm; solo para regenerar data/cuencas.geojson):
    python -m venv venv && venv/bin/pip install -r scripts/delinear/requirements.txt
    venv/bin/python scripts/delinear/delinear.py --dem-dir <carpeta con mosaicos Copernicus> --salida data/cuencas.geojson

DEM: Copernicus DEM GLO-30 (30 m), mosaicos de https://copernicus-dem-30m.s3.amazonaws.com/
Método: pysheds (relleno de sumideros y depresiones, flats, dirección D8, acumulación, cuenca).
"""
import argparse, glob, json, math, os, sys, tempfile
import numpy as np
import rasterio
from rasterio.merge import merge
from pysheds.grid import Grid
from shapely.geometry import shape, mapping, Point
from shapely.ops import unary_union
import shapely

AQUI = os.path.dirname(os.path.abspath(__file__))


def mosaico(dem_dir, ventana):
    oeste, sur, este, norte = ventana
    fuentes = [rasterio.open(f) for f in sorted(glob.glob(os.path.join(dem_dir, "*.tif")))]
    datos, transformada = merge(fuentes, bounds=(oeste, sur, este, norte))
    perfil = fuentes[0].profile | {"height": datos.shape[1], "width": datos.shape[2], "transform": transformada, "driver": "GTiff", "nodata": -9999}
    ruta = os.path.join(tempfile.mkdtemp(), "mosaico.tif")
    with rasterio.open(ruta, "w", **perfil) as d:
        d.write(datos)
    return ruta


def area_km2(geom):
    """Área geodésica aproximada: proyección equiárea local (suficiente para cientos de km²)."""
    k = math.cos(math.radians(geom.centroid.y))
    R = 6371.0088
    return shapely.transform(geom, lambda c: np.column_stack((np.radians(c[:, 0]) * R * k, np.radians(c[:, 1]) * R))).area


def delinear(ruta_dem, punto, radio_m, area_min_km2, area_max_km2):
    grid = Grid.from_raster(ruta_dem)
    dem = grid.read_raster(ruta_dem)
    dem = grid.fill_depressions(grid.fill_pits(dem))
    dem = grid.resolve_flats(dem)
    fdir = grid.flowdir(dem)
    acc = grid.accumulation(fdir)
    # Área de cada celda (~30 m) en km²: el tamaño en grados se convierte con la latitud.
    paso = grid.affine.a
    celda_km2 = (paso * 111.32) ** 2 * math.cos(math.radians(punto["lat"]))
    # Celda de cauce más cercana entre las que drenan al menos `area_min_km2`. El umbral se elige por
    # quebrada para caer en su cauce principal y no en una cárcava lateral ni en el río principal.
    # area_max_km2 excluye al río principal (p. ej. el Rímac junto a la desembocadura de una quebrada).
    cauce = (acc * celda_km2 >= area_min_km2) & (acc * celda_km2 <= area_max_km2)
    sx, sy = grid.snap_to_mask(cauce, (punto["lon"], punto["lat"]))
    cuenca = grid.catchment(x=sx, y=sy, fdir=fdir, xytype="coordinate", snap="center")
    x, y = punto["lon"], punto["lat"]
    grid.clip_to(cuenca)
    poligonos = [shape(g) for g, v in grid.polygonize() if v]
    geom = unary_union(poligonos)
    # ¿Toca el borde del mosaico? Entonces la cuenca está incompleta.
    b = rasterio.open(ruta_dem).bounds
    margen = 2 * paso
    toca = geom.bounds[0] <= b.left + margen or geom.bounds[1] <= b.bottom + margen or geom.bounds[2] >= b.right - margen or geom.bounds[3] >= b.top - margen
    if radio_m and Point(x, y).distance(Point(sx, sy)) * 111_320 > radio_m:
        sys.exit(f"{punto['id']}: el cauce más cercano está a más de {radio_m} m del punto de referencia")
    return geom, (sx, sy), Point(x, y).distance(Point(sx, sy)) * 111_320, toca, float(dem[cuenca].min()), float(dem[cuenca].max())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dem-dir", required=True)
    ap.add_argument("--salida", required=True)
    ap.add_argument("--ventana", default="-77.0,-12.15,-76.40,-11.55", help="oeste,sur,este,norte")
    ap.add_argument("--tolerancia", type=float, default=0.0005, help="simplificación en grados (~55 m)")
    a = ap.parse_args()
    puntos = json.load(open(os.path.join(AQUI, "puntos.json")))
    ruta = mosaico(a.dem_dir, tuple(float(v) for v in a.ventana.split(",")))
    features = []
    for p in puntos:
        geom, salida, dist, toca, zmin, zmax = delinear(ruta, p, p.get("radio_m", 500), p.get("area_min_km2", 1.0), p.get("area_max_km2", float("inf")))
        if toca:
            sys.exit(f"{p['id']}: la cuenca toca el borde de la ventana ({area_km2(geom):.0f} km², límites {tuple(round(v, 3) for v in geom.bounds)}): amplía --ventana o revisa el punto")
        simple = geom.simplify(a.tolerancia, preserve_topology=True)
        km2 = area_km2(geom)
        print(f"{p['id']}: {km2:.1f} km², salida ajustada a {dist:.0f} m, cota {zmin:.0f}-{zmax:.0f} m", file=sys.stderr)
        features.append({
            "type": "Feature",
            "id": p["id"],
            "geometry": mapping(simple),
            "properties": {
                "id": p["id"],
                "nombre": p["nombre"],
                "area_km2": round(km2, 1),
                "cota_min_m": round(zmin),
                "cota_max_m": round(zmax),
                "salida": {"lat": round(salida[1], 5), "lon": round(salida[0], 5), "ajuste_m": round(dist)},
                "punto_de_referencia": p["referencia"],
                "igp_estaciones": p.get("igp_estaciones", []),
                "igp_quebrada": p.get("igp_quebrada"),
                "referencia_area_km2": p.get("referencia_area_km2"),
            },
        })
    meta = {
        "dem": "Copernicus DEM GLO-30 © DLR e.V. 2010-2014 y © Airbus Defence and Space GmbH 2014-2018, provisto bajo COPERNICUS por la Unión Europea y la ESA",
        "metodo": "pysheds 0.5: fill_pits, fill_depressions, resolve_flats, flowdir D8, accumulation, catchment; salida = celda de cauce más cercana",
        "simplificacion_grados": a.tolerancia,
    }
    with open(a.salida, "w") as f:
        json.dump({"type": "FeatureCollection", "metadata": meta, "features": features}, f, ensure_ascii=False)
        f.write("\n")


if __name__ == "__main__":
    main()
