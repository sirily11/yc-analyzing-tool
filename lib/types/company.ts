export type YcCompany = {
  id: number;
  name: string;
  slug: string;
  website: string | null;
  batch: string;
  year: number;
  industry: string;
  subindustry: string;
  oneLiner: string;
  location: string;
  operatingArea: string;
  targetMarket: string;
  aiLinked: boolean;
  hiring: boolean;
  logo: string | null;
  x: number;
  y: number;
};

export type YcCompanyDatasetEvidence = {
  companyId: number;
  longDescription: string;
  tags: string[];
};

export type DatasetManifest = {
  version: string;
  source: string;
  generatedAt: string;
  firstYear: number;
  lastYear: number;
  companyCount: number;
  batches: string[];
  industries: string[];
};

export type YcFounder = {
  id: number;
  name: string;
  title: string;
  bio: string;
  linkedIn: string | null;
  twitter: string | null;
};

export type YcCompanyDetail = {
  longDescription: string;
  yearFounded: number | null;
  teamSize: number | null;
  status: string;
  tags: string[];
  founders: YcFounder[];
};
