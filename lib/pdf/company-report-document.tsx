import { Circle, Document, Line, Link, Page, Rect, StyleSheet, Svg, Text, View } from "@react-pdf/renderer";
import { pdfText } from "@/lib/pdf/report-document";
import { REPORT_MAP_COLORS, REPORT_MAP_HEIGHT, REPORT_MAP_WIDTH } from "@/lib/report-map";
import type { CompanyResearchReportDocument } from "@/lib/types/company-research";
import type { YcCompany } from "@/lib/types/company";

const styles = StyleSheet.create({
  page: { backgroundColor: "#f3efe5", color: "#25211d", padding: 36, paddingBottom: 50, fontFamily: "Helvetica", fontSize: 9 },
  kicker: { color: "#d85b35", fontSize: 7, letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 12 },
  title: { fontFamily: "Times-Roman", fontSize: 38, lineHeight: 1.02, marginBottom: 16 },
  sectionTitle: { fontFamily: "Times-Roman", fontSize: 25, lineHeight: 1.05, marginBottom: 13 },
  companyTitle: { fontFamily: "Times-Roman", fontSize: 31, lineHeight: 1, marginBottom: 12 },
  summary: { color: "#5f584f", fontSize: 10.5, lineHeight: 1.55, maxWidth: 500 },
  sectionLabel: { color: "#70695f", fontSize: 7, letterSpacing: 1, textTransform: "uppercase", marginBottom: 8 },
  divider: { borderTop: "1px solid #cec6b7", marginVertical: 20 },
  metricRow: { display: "flex", flexDirection: "row", borderTop: "1px solid #cec6b7", borderBottom: "1px solid #cec6b7", marginTop: 28 },
  metric: { flex: 1, paddingVertical: 14, borderRight: "1px solid #cec6b7" },
  metricLast: { flex: 1, paddingVertical: 14, paddingLeft: 14 },
  metricValue: { fontFamily: "Times-Roman", fontSize: 27, lineHeight: .9, marginBottom: 5 },
  muted: { color: "#70695f", lineHeight: 1.45 },
  map: { height: 305, border: "1px solid #cec6b7", marginTop: 12, marginBottom: 10 },
  mapCaption: { color: "#70695f", fontSize: 7.5, lineHeight: 1.45 },
  profileMeta: { color: "#d85b35", fontSize: 7, letterSpacing: .8, textTransform: "uppercase", marginBottom: 8 },
  overview: { color: "#5f584f", fontSize: 10, lineHeight: 1.55, marginBottom: 20 },
  fact: { display: "flex", flexDirection: "row", gap: 16, borderTop: "1px solid #cec6b7", paddingVertical: 9 },
  factLabel: { width: 92, color: "#d85b35", fontSize: 7, letterSpacing: .7, textTransform: "uppercase" },
  factValue: { flex: 1, color: "#5f584f", lineHeight: 1.5 },
  evidenceColumns: { display: "flex", flexDirection: "row", gap: 22, marginTop: 20 },
  evidenceColumn: { flex: 1 },
  insight: { borderTop: "1px solid #cec6b7", paddingVertical: 8, color: "#5f584f", lineHeight: 1.45 },
  citation: { color: "#b74627", fontSize: 7 },
  unknown: { borderTop: "1px solid #cec6b7", paddingVertical: 8, color: "#70695f", lineHeight: 1.45 },
  comparisonGrid: { display: "flex", flexDirection: "row", flexWrap: "wrap", gap: 18 },
  comparisonSection: { width: "48%", marginBottom: 12 },
  source: { borderTop: "1px solid #cec6b7", paddingVertical: 8 },
  sourceRow: { display: "flex", flexDirection: "row", gap: 12 },
  sourceNumber: { width: 25, color: "#d85b35", fontSize: 7 },
  sourceBody: { flex: 1 },
  sourceTitle: { fontFamily: "Helvetica-Bold", fontSize: 8.5, marginBottom: 3 },
  sourceLink: { color: "#b74627", fontSize: 6.5, lineHeight: 1.35, textDecoration: "none", marginTop: 3 },
  warning: { borderTop: "1px solid #cec6b7", paddingVertical: 7, color: "#70695f", lineHeight: 1.45 },
  footer: { position: "absolute", left: 36, right: 36, bottom: 22, borderTop: "1px solid #cec6b7", paddingTop: 8, display: "flex", flexDirection: "row", justifyContent: "space-between", fontSize: 6, color: "#70695f" },
});

function citations(sourceIds: string[], sourceNumbers: Map<string, number>) {
  return sourceIds.map((id) => `[${sourceNumbers.get(id) ?? "?"}]`).join(" ");
}

function FooterContents({ report }: { report: CompanyResearchReportDocument }) {
  return <>
    <Text>Application Signal - Private public-company research</Text>
    <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} / ${totalPages} - ${report.map.datasetVersion} - ${report.map.modelVersion}`} />
  </>;
}

function Footer({ report }: { report: CompanyResearchReportDocument }) {
  return <View style={styles.footer} fixed>
    <FooterContents report={report} />
  </View>;
}

function StaticFooter({ report }: { report: CompanyResearchReportDocument }) {
  return <View style={styles.footer}>
    <FooterContents report={report} />
  </View>;
}

function CitedInsight({ text, sourceIds, sourceNumbers }: { text: string; sourceIds: string[]; sourceNumbers: Map<string, number> }) {
  return <Text style={styles.insight}>{pdfText(text)} <Text style={styles.citation}>{citations(sourceIds, sourceNumbers)}</Text></Text>;
}

export function CompanyResearchReportPdf({ report, companies }: { report: CompanyResearchReportDocument; companies: YcCompany[] }) {
  const companyById = new Map(companies.map((company) => [company.id, company]));
  const sourceNumbers = new Map(report.sources.map((source, index) => [source.id, index + 1]));
  const usableSources = report.sources.filter((source) => source.status === "ok").length;
  const targetCount = report.map.points.filter((point) => point.target).length;

  return <Document title={report.title} author="Application Signal" subject="Private public-company research report">
    <Page size="A4" style={styles.page}>
      <Text style={styles.kicker}>Private YC company research - Independent analysis</Text>
      <Text style={styles.title}>{pdfText(report.title)}</Text>
      <Text style={styles.summary}>{pdfText(report.executiveSummary)}</Text>
      <View style={styles.metricRow}>
        <View style={styles.metric}><Text style={styles.metricValue}>{report.companies.length}</Text><Text style={styles.sectionLabel}>Researched companies</Text></View>
        <View style={[styles.metric, { paddingLeft: 14 }]}><Text style={styles.metricValue}>{usableSources}</Text><Text style={styles.sectionLabel}>Usable public sources</Text></View>
        <View style={styles.metricLast}><Text style={styles.metricValue}>{targetCount}</Text><Text style={styles.sectionLabel}>Mapped targets</Text></View>
      </View>
      <View style={styles.divider} />
      <Text style={styles.sectionLabel}>Research request</Text>
      <Text style={styles.summary}>{pdfText(report.request)}</Text>
      <View style={styles.divider} />
      <Text style={styles.sectionLabel}>Important context</Text>
      <Text style={styles.muted}>This report uses public YC directory facts and time-stamped public web research. It is not admissions advice, an acceptance probability, or an investment recommendation.</Text>
      <Footer report={report} />
    </Page>

    <Page size="A4" style={styles.page}>
      <Text style={styles.kicker}>01 / Semantic position</Text>
      <Text style={styles.sectionTitle}>Request-specific company landscape</Text>
      <Text style={styles.summary}>The map blends versioned YC model signals with current public website language. Orange nodes are the researched companies.</Text>
      <StaticFooter report={report} />
      <Svg style={styles.map} viewBox={`0 0 ${REPORT_MAP_WIDTH} ${REPORT_MAP_HEIGHT}`} preserveAspectRatio="xMidYMid meet">
        <Rect x={0} y={0} width={REPORT_MAP_WIDTH} height={REPORT_MAP_HEIGHT} fill="#f3efe5" />
        {Array.from({ length: Math.ceil(REPORT_MAP_WIDTH / 36) + 1 }).map((_, index) => <Line key={`x-${index}`} x1={index * 36} x2={index * 36} y1={0} y2={REPORT_MAP_HEIGHT} stroke="#cec6b7" strokeWidth={.7} />)}
        {Array.from({ length: Math.ceil(REPORT_MAP_HEIGHT / 36) + 1 }).map((_, index) => <Line key={`y-${index}`} x1={0} x2={REPORT_MAP_WIDTH} y1={index * 36} y2={index * 36} stroke="#cec6b7" strokeWidth={.7} />)}
        {report.map.points.map((point) => {
          const company = companyById.get(point.companyId);
          const x = point.x * 700 + 30;
          const y = point.y * 370 + 30;
          const fill = point.target ? "#d85b35" : REPORT_MAP_COLORS[company?.year ?? 0] ?? "#70695f";
          return <Circle key={point.companyId} cx={x} cy={y} r={point.target ? 5.5 : 2.5} fill={fill} opacity={point.target ? .96 : .48} stroke={point.target ? "#25211d" : "none"} strokeWidth={point.target ? 1.2 : 0} />;
        })}
      </Svg>
      <Text style={styles.mapCaption}>70% versioned model signal and 30% current public website language. Distance indicates similarity within this request-specific view; axes are layout coordinates, not business metrics or scores.</Text>
      {report.map.warning && <><View style={styles.divider} /><Text style={styles.sectionLabel}>Map coverage note</Text><Text style={styles.warning}>{pdfText(report.map.warning)}</Text></>}
    </Page>

    {report.companies.map((company, index) => <Page size="A4" style={styles.page} key={company.companyId}>
      <Text style={styles.kicker}>{String(index + 2).padStart(2, "0")} / Company snapshot</Text>
      <Text style={styles.profileMeta}>{pdfText(company.batch)} - {pdfText(company.industry)} - {pdfText(company.location)}</Text>
      <Text style={styles.companyTitle}>{pdfText(company.name)}</Text>
      <Text style={styles.overview}>{pdfText(company.overview.text)} <Text style={styles.citation}>{citations(company.overview.sourceIds, sourceNumbers)}</Text></Text>
      {([
        ["Product", company.product],
        ["Customers", company.customers],
        ["Business model", company.businessModel],
      ] as const).map(([label, insight]) => <View style={styles.fact} key={label}>
        <Text style={styles.factLabel}>{label}</Text>
        <Text style={styles.factValue}>{pdfText(insight.text)} <Text style={styles.citation}>{citations(insight.sourceIds, sourceNumbers)}</Text></Text>
      </View>)}
      {(company.signals.length > 0 || company.unknowns.length > 0) && <View style={styles.evidenceColumns}>
        <View style={styles.evidenceColumn}><Text style={styles.sectionLabel}>Public signals</Text>{company.signals.length ? company.signals.map((item) => <CitedInsight key={`${item.text}-${item.sourceIds.join("-")}`} {...item} sourceNumbers={sourceNumbers} />) : <Text style={styles.muted}>No material public signals were recorded.</Text>}</View>
        <View style={styles.evidenceColumn}><Text style={styles.sectionLabel}>Important unknowns</Text>{company.unknowns.length ? company.unknowns.map((item) => <Text style={styles.unknown} key={item}>{pdfText(item)}</Text>) : <Text style={styles.muted}>No additional unknowns were recorded.</Text>}</View>
      </View>}
      {company.website && <><View style={styles.divider} /><Text style={styles.sectionLabel}>Official website</Text><Link style={styles.sourceLink} src={company.website}>{company.website}</Link></>}
      <Footer report={report} />
    </Page>)}

    <Page size="A4" style={styles.page}>
      <Text style={styles.kicker}>Comparison</Text>
      <Text style={styles.sectionTitle}>Patterns, differences, and decisions</Text>
      <View style={styles.comparisonGrid}>
        {([
          ["Shared patterns", report.comparison.sharedPatterns],
          ["Differentiators", report.comparison.differentiators],
          ["Opportunities", report.comparison.opportunities],
          ["Risks", report.comparison.risks],
        ] as const).map(([label, items]) => <View style={styles.comparisonSection} key={label}>
          <Text style={styles.sectionLabel}>{label}</Text>
          {items.length ? items.map((item) => <CitedInsight key={`${item.text}-${item.sourceIds.join("-")}`} {...item} sourceNumbers={sourceNumbers} />) : <Text style={styles.muted}>No sourced findings were recorded.</Text>}
        </View>)}
      </View>
      <Footer report={report} />
    </Page>

    <Page size="A4" style={styles.page}>
      <Text style={styles.kicker}>Sources and methodology</Text>
      <Text style={styles.sectionTitle}>Public research index</Text>
      {report.sources.map((source, index) => <View style={styles.source} key={source.id}>
        <View style={styles.sourceRow}>
          <Text style={styles.sourceNumber}>[{index + 1}]</Text>
          <View style={styles.sourceBody}>
            <Text style={styles.sourceTitle}>{pdfText(source.title)}</Text>
            <Text style={styles.muted}>{pdfText(source.kind)} - {pdfText(source.status)}{source.note ? ` - ${pdfText(source.note)}` : ""}</Text>
            <Link style={styles.sourceLink} src={source.url}>{source.url}</Link>
          </View>
        </View>
      </View>)}
      <View style={styles.divider} />
      <Text style={styles.sectionLabel}>Methodology</Text>
      <Text style={styles.muted}>{pdfText(report.methodology)}</Text>
      <View style={styles.divider} />
      <Text style={styles.sectionLabel}>Coverage notes</Text>
      {report.warnings.length ? report.warnings.map((warning) => <Text style={styles.warning} key={warning}>{pdfText(warning)}</Text>) : <Text style={styles.muted}>No source coverage warnings were recorded.</Text>}
      <Footer report={report} />
    </Page>
  </Document>;
}
