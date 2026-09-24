/**
 * Decodes a Google-style encoded polyline (as returned by Neshan's
 * `overview_polyline.points`, precision 5) into GeoJSON-ordered
 * [longitude, latitude] pairs.
 */
export function decodePolylineToGeoJson(encoded: string, precision = 5): [number, number][] {
  const factor = 10 ** precision;
  const coordinates: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  const readValue = (): number | null => {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      if (index >= encoded.length) return null; // truncated input
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };

  while (index < encoded.length) {
    const dLat = readValue();
    const dLng = readValue();
    if (dLat === null || dLng === null) break;
    lat += dLat;
    lng += dLng;
    coordinates.push([lng / factor, lat / factor]);
  }
  return coordinates;
}
