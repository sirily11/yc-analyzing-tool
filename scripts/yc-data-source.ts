import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  coordinateMapFromCompanies,
  normalizeYcCompanies,
  YC_SOURCE_URL,
  type YcSourceCompany,
} from "../lib/yc/source";

export async function fetchYcSource(fetchImplementation: typeof fetch = fetch) {
  const response = await fetchImplementation(YC_SOURCE_URL, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Application-Signal YC data sync",
    },
  });
  if (!response.ok) throw new Error(`YC data download failed: ${response.status}`);
  const source = await response.json();
  if (!Array.isArray(source)) throw new Error("YC data download did not return an array.");
  return source as YcSourceCompany[];
}

export async function loadLearnedCoordinates(
  modelVersion: string,
  configuredPath: string | undefined = process.env.YC_COORDINATES_PATH,
) {
  const coordinatesPath = configuredPath
    ? path.resolve(configuredPath)
    : path.join(process.cwd(), "ml", "artifacts", modelVersion, "directory-companies.json");
  try {
    const source = JSON.parse(await readFile(coordinatesPath, "utf8")) as unknown;
    const coordinates = coordinateMapFromCompanies(source);
    return { coordinates, coordinatesPath };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { coordinates: new Map(), coordinatesPath: null };
    }
    throw new Error(`Could not load learned YC coordinates from ${coordinatesPath}.`, { cause: error });
  }
}

export async function loadNormalizedYcCompanies(options: {
  modelVersion: string;
  coordinatesPath?: string;
  fetchImplementation?: typeof fetch;
  lastYear?: number;
}) {
  const [source, learned] = await Promise.all([
    fetchYcSource(options.fetchImplementation),
    loadLearnedCoordinates(options.modelVersion, options.coordinatesPath),
  ]);
  return {
    companies: normalizeYcCompanies(source, {
      lastYear: options.lastYear,
      learnedCoordinates: learned.coordinates,
    }),
    learnedCoordinateCount: learned.coordinates.size,
    coordinatesPath: learned.coordinatesPath,
  };
}
