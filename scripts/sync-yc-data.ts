import { exportYcData } from "./export-yc-data";

export { exportYcData };

if (import.meta.main) {
  const result = await exportYcData();
  console.log(`Exported ${result.companyCount.toLocaleString()} YC companies to ${result.outputDirectory}.`);
}
