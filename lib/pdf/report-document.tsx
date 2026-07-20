import { Circle, Document, Line, Link, Page, Rect, StyleSheet, Svg, Text, View } from "@react-pdf/renderer";
import { projectReportMapPoint, REPORT_MAP_COLORS, REPORT_MAP_HEIGHT, REPORT_MAP_WIDTH, selectReportMapCompanies } from "@/lib/report-map";
import type { ReportDocument } from "@/lib/types/analysis";
import type { YcCompany } from "@/lib/types/company";

const styles = StyleSheet.create({
  page: { backgroundColor: "#f3efe5", color: "#25211d", padding: 34, paddingBottom: 48, fontFamily: "Helvetica", fontSize: 9 },
  kicker: { color: "#d85b35", fontSize: 7, letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 12 },
  title: { fontFamily: "Times-Roman", fontSize: 42, lineHeight: 1, marginBottom: 16 },
  summary: { color: "#5f584f", fontSize: 10, lineHeight: 1.55, width: "68%" },
  fullSummary: { color: "#5f584f", fontSize: 10, lineHeight: 1.55, maxWidth: 490, marginBottom: 18 },
  scoreBox: { position: "absolute", right: 34, top: 43, borderLeft: "1px solid #cec6b7", paddingLeft: 18, width: 130 },
  scoreLabel: { fontSize: 7, letterSpacing: 1, textTransform: "uppercase", color: "#70695f" },
  score: { fontFamily: "Times-Roman", fontSize: 55, color: "#d85b35", lineHeight: 0.9, marginTop: 7 },
  divider: { borderTop: "1px solid #cec6b7", marginVertical: 20 },
  sectionLabel: { fontSize: 7, letterSpacing: 1, textTransform: "uppercase", color: "#70695f", marginBottom: 8 },
  sectionTitle: { fontFamily: "Times-Roman", fontSize: 23, marginBottom: 12 },
  map: { height: 294, border: "1px solid #cec6b7", marginBottom: 12 },
  mapCaption: { color: "#70695f", fontSize: 7, lineHeight: 1.45 },
  columns: { display: "flex", flexDirection: "row", gap: 20 },
  column: { flex: 1 },
  item: { borderTop: "1px solid #cec6b7", paddingVertical: 7, lineHeight: 1.35 },
  ycLink: { color: "#b74627", fontSize: 6.5, lineHeight: 1.35, marginTop: 4, textDecoration: "none" },
  profileValue: { marginTop: 3 },
  factorGrid: { display: "flex", flexDirection: "row", flexWrap: "wrap", gap: 10 },
  factor: { width: "48%", borderTop: "1px solid #cec6b7", paddingTop: 7, display: "flex", flexDirection: "row", justifyContent: "space-between" },
  rec: { display: "flex", flexDirection: "row", borderTop: "1px solid #cec6b7", paddingVertical: 8, gap: 12 },
  recNo: { color: "#d85b35", width: 20 },
  recBody: { flex: 1 },
  recTitle: { fontSize: 10, fontFamily: "Helvetica-Bold", marginBottom: 3 },
  muted: { color: "#70695f", lineHeight: 1.4 },
  methodology: { color: "#70695f", fontSize: 8, lineHeight: 1.5 },
  evidenceItem: { borderTop: "1px solid #cec6b7", paddingVertical: 8 },
  evidenceLabel: { color: "#d85b35", fontSize: 6.5, letterSpacing: .7, textTransform: "uppercase", marginBottom: 4 },
  diagnosisItem: { marginBottom: 12 },
  diagnosisTitle: { fontFamily: "Helvetica-Bold", fontSize: 9, marginBottom: 4 },
  researchCompany: { borderTop: "1px solid #cec6b7", paddingTop: 10, marginBottom: 13 },
  researchCompanyTitle: { fontFamily: "Times-Roman", fontSize: 18, marginBottom: 6 },
  researchGrid: { display: "flex", flexDirection: "row", gap: 12 },
  researchCell: { flex: 1 },
  sourceItem: { borderTop: "1px solid #cec6b7", paddingVertical: 6 },
  sourceLink: { color: "#b74627", fontSize: 6.5, textDecoration: "none", marginTop: 3 },
  actionCard: { width: "48%", borderTop: "1px solid #cec6b7", paddingTop: 8, marginBottom: 12 },
  footer: { position: "absolute", left: 34, right: 34, bottom: 22, borderTop: "1px solid #cec6b7", paddingTop: 8, display: "flex", flexDirection: "row", justifyContent: "space-between", fontSize: 6, color: "#70695f" },
});

export function pdfText(value: unknown) {
  if (value === null || value === undefined || value === "") return "Not provided";
  return String(value).replace(/[\u2011\u2013\u2014]/g, "-");
}

function Footer({ report }: { report: ReportDocument }) {
  return <View style={styles.footer} fixed>
    <Text>Application Signal - Independent and not affiliated with Y Combinator</Text>
    <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} / ${totalPages} - ${report.prediction.datasetVersion} - ${report.prediction.modelVersion}`} />
  </View>;
}

export function ReportPdf({ report, companies }: { report: ReportDocument; companies: YcCompany[] }) {
  const point = report.prediction.clusterPoint;
  const candidatePoint = projectReportMapPoint(point);
  const nearest = new Set(report.prediction.nearestCompanyIds);
  const mapNodes = selectReportMapCompanies(companies, point, 180);
  const companiesById = new Map(companies.map((company) => [company.id, company]));
  const founder = report.profile.founderProfile;
  const components = report.prediction.scoreComponents;
  const dossier = report.schemaVersion === 2 ? report.dossier : undefined;
  const profileItems = [
    ["Sector", report.profile.sector],
    ["Subindustry", report.profile.subindustry],
    ["Customer", report.profile.targetCustomer],
    ["Business model", report.profile.businessModel],
    ["Product", report.profile.productModality],
    ["Stage", report.profile.stage],
    ...(founder ? [
      ["Founder capabilities", founder.capabilityDomains.length ? founder.capabilityDomains.join(", ") : "Not evidenced"],
      ["Domain experience", founder.domainExperience],
      ["Technical capability", founder.technicalCapability],
      ["Team complementarity", founder.teamComplementarity],
    ] : []),
  ];

  return <Document title={report.title} author="Application Signal" subject="Independent YC fit report">
    <Page size="A4" style={styles.page}>
      <Text style={styles.kicker}>Private application signal - Independent analysis</Text>
      <Text style={styles.title}>{pdfText(report.profile.companyName)}</Text>
      <Text style={styles.summary}>{pdfText(report.executiveSummary)}</Text>
      <View style={styles.scoreBox}>
        <Text style={styles.scoreLabel}>YC Fit Score</Text>
        <Text style={styles.score}>{Math.round(report.prediction.score)}</Text>
        <Text style={styles.muted}>/100 - {report.prediction.band}{"\n"}Evidence: {report.prediction.coverage}{components ? `\nStartup ${Math.round(components.startupFit)} - Founder ${components.founderFit === null ? "N/A" : Math.round(components.founderFit)}` : ""}</Text>
      </View>
      <View style={styles.divider} />
      <Text style={styles.sectionLabel}>01 / Position</Text>
      <Text style={styles.sectionTitle}>Position in the recent YC map</Text>
      <Svg style={styles.map} viewBox={`0 0 ${REPORT_MAP_WIDTH} ${REPORT_MAP_HEIGHT}`} preserveAspectRatio="xMidYMid meet">
        <Rect x={0} y={0} width={REPORT_MAP_WIDTH} height={REPORT_MAP_HEIGHT} fill="#f3efe5" />
        {Array.from({ length: Math.ceil(REPORT_MAP_WIDTH / 36) + 1 }).map((_, index) => <Line key={`x-${index}`} x1={index * 36} x2={index * 36} y1={0} y2={REPORT_MAP_HEIGHT} stroke="#cec6b7" strokeWidth={.7} />)}
        {Array.from({ length: Math.ceil(REPORT_MAP_HEIGHT / 36) + 1 }).map((_, index) => <Line key={`y-${index}`} x1={0} x2={REPORT_MAP_WIDTH} y1={index * 36} y2={index * 36} stroke="#cec6b7" strokeWidth={.7} />)}
        {mapNodes.map(({ company }) => {
          const companyPoint = projectReportMapPoint(company);
          const isNearest = nearest.has(company.id);
          return <Circle key={company.id} cx={companyPoint.x} cy={companyPoint.y} r={isNearest ? 4.8 : 2.4} fill={REPORT_MAP_COLORS[company.year] ?? "#70695f"} opacity={isNearest ? .95 : .48} />;
        })}
        <Circle cx={candidatePoint.x} cy={candidatePoint.y} r={15} fill="#d85b35" opacity={.2} />
        <Circle cx={candidatePoint.x} cy={candidatePoint.y} r={7} fill="#d85b35" stroke="#25211d" strokeWidth={2} />
      </Svg>
      <Text style={styles.mapCaption}>This uses the same versioned public-company positions shown in the interactive report. The highlighted node is the uploaded application; larger surrounding dots are its twelve nearest public YC companies.</Text>
      <View style={styles.divider} />
      <Text style={styles.sectionLabel}>Model-derived factors</Text>
      <View style={styles.factorGrid} wrap={false}>
        {report.prediction.factors.map((factor) => <View key={factor.label} style={styles.factor}>
          <Text style={styles.muted}>{pdfText(factor.label)}</Text>
          <Text>{pdfText(factor.value)}</Text>
        </View>)}
      </View>
      <Footer report={report} />
    </Page>

    <Page size="A4" style={styles.page}>
      <Text style={styles.kicker}>Profile and comparables</Text>
      <Text style={styles.title}>Where it fits.</Text>
      <View style={styles.divider} />
      <Text style={styles.sectionLabel}>Application thesis</Text>
      <Text style={styles.fullSummary}>{pdfText(report.profile.summary)}</Text>
      <View style={styles.columns} wrap={false}>
        <View style={styles.column}>
          <Text style={styles.sectionLabel}>Application profile</Text>
          {profileItems.map(([label, value]) => <View style={styles.item} key={label}>
            <Text style={styles.muted}>{label}</Text>
            <Text style={styles.profileValue}>{pdfText(value)}</Text>
          </View>)}
        </View>
        <View style={styles.column}>
          <Text style={styles.sectionLabel}>Closest public analogs</Text>
          {report.comparableCompanies.slice(0, 6).map((company) => {
            const publicCompany = companiesById.get(company.id);
            const ycUrl = publicCompany ? `https://www.ycombinator.com/companies/${encodeURIComponent(publicCompany.slug)}` : null;
            return <View style={styles.item} key={company.id}>
              <Text>{pdfText(company.name)} - {Math.round(company.similarity * 100)}%</Text>
              <Text style={styles.muted}>{pdfText(company.oneLiner)}</Text>
              {ycUrl && <Link style={styles.ycLink} src={ycUrl}>{ycUrl}</Link>}
            </View>;
          })}
        </View>
      </View>
      <Footer report={report} />
    </Page>

    <Page size="A4" style={styles.page}>
      <Text style={styles.kicker}>Application evidence</Text>
      <Text style={styles.title}>Sharpen the signal.</Text>
      <View style={styles.divider} />
      <View style={styles.columns} wrap={false}>
        <View style={styles.column}>
          <Text style={styles.sectionLabel}>Strengths</Text>
          {report.strengths.map((item) => <Text style={styles.item} key={item}>+ {pdfText(item)}</Text>)}
        </View>
        <View style={styles.column}>
          <Text style={styles.sectionLabel}>Gaps</Text>
          {report.gaps.map((item) => <Text style={styles.item} key={item}>- {pdfText(item)}</Text>)}
        </View>
      </View>
      {!dossier && <><View style={styles.divider} /><Text style={styles.sectionLabel}>Improvement plan</Text>{report.recommendations.map((item) => <View style={styles.rec} key={item.priority} wrap={false}>
        <Text style={styles.recNo}>{String(item.priority).padStart(2, "0")}</Text><View style={styles.recBody}><Text style={styles.recTitle}>{pdfText(item.title)}</Text><Text style={styles.muted}>{pdfText(item.detail)}</Text></View>
      </View>)}</>}
      <View style={styles.divider} />
      <Text style={styles.sectionLabel}>Methodology and limitations</Text>
      <Text style={styles.methodology}>{pdfText(report.methodology)}{"\n\n"}{pdfText(report.disclaimer)}</Text>
      <Footer report={report} />
    </Page>

    {dossier && <Page size="A4" style={styles.page}>
      <Text style={styles.kicker}>Candidate evidence and diagnosis</Text>
      <Text style={styles.title}>What is established.</Text>
      <Text style={styles.fullSummary}>{pdfText(dossier.scoreInterpretation)}</Text>
      <View style={styles.columns}>
        <View style={styles.column}><Text style={styles.sectionLabel}>Evidence snapshot</Text>{dossier.candidateEvidence.map((item, index) => <View style={styles.evidenceItem} key={`${item.claim}-${index}`} wrap={false}><Text style={styles.evidenceLabel}>{item.page ? `Page ${item.page}` : item.sourceLabel}</Text><Text>{pdfText(item.claim)}</Text></View>)}</View>
        <View style={styles.column}><Text style={styles.sectionLabel}>Application diagnosis</Text>{([
          ["Market and customer", dossier.diagnosis.marketCustomer], ["Product", dossier.diagnosis.product], ["Traction", dossier.diagnosis.traction], ["Founders", dossier.diagnosis.founders], ["Readiness", dossier.diagnosis.readiness],
        ] as Array<[string, string]>).map(([title, detail]) => <View style={styles.diagnosisItem} key={title} wrap={false}><Text style={styles.diagnosisTitle}>{title}</Text><Text style={styles.muted}>{pdfText(detail)}</Text></View>)}</View>
      </View>
      <Footer report={report} />
    </Page>}

    {dossier && <Page size="A4" style={styles.page}>
      <Text style={styles.kicker}>Comparable-company research</Text>
      <Text style={styles.title}>Patterns, not predictions.</Text>
      <Text style={styles.fullSummary}>The local model selected these neighbors. Public website, founder, and related-source research explains useful execution patterns without changing the fit score.</Text>
      {dossier.companyDeepDives.map((company, index) => <View style={styles.researchCompany} key={company.companyId}>
        <Text style={styles.evidenceLabel}>{String(index + 1).padStart(2, "0")} / Sources {company.sourceIds.join(", ")}</Text>
        <Text style={styles.researchCompanyTitle}>{pdfText(company.companyName)}</Text>
        <Text style={styles.muted}>{pdfText(company.overview)}</Text>
        <View style={[styles.researchGrid, { marginTop: 8 }]}><View style={styles.researchCell}><Text style={styles.diagnosisTitle}>Website</Text><Text style={styles.muted}>{pdfText(company.websiteAnalysis)}</Text></View><View style={styles.researchCell}><Text style={styles.diagnosisTitle}>Founders</Text><Text style={styles.muted}>{pdfText(company.founderAnalysis)}</Text></View><View style={styles.researchCell}><Text style={styles.diagnosisTitle}>Traction</Text><Text style={styles.muted}>{pdfText(company.tractionAnalysis)}</Text></View></View>
        <Text style={[styles.muted, { marginTop: 7 }]}>Similarities: {pdfText(company.similarities.join(" "))}{"\n"}Differences: {pdfText(company.differences.join(" "))}{"\n"}Lessons: {pdfText(company.lessons.join(" "))}</Text>
      </View>)}
      <Footer report={report} />
    </Page>}

    {dossier && <Page size="A4" style={styles.page}>
      <Text style={styles.kicker}>Application improvements</Text>
      <Text style={styles.title}>Make the next draft count.</Text>
      {dossier.recommendations.map((item) => <View style={styles.rec} key={item.priority}><Text style={styles.recNo}>{String(item.priority).padStart(2, "0")}</Text><View style={styles.recBody}><Text style={styles.recTitle}>{pdfText(item.title)}</Text><Text style={styles.muted}>{pdfText(item.action)}{"\n"}Why: {pdfText(item.rationale)}{"\n"}Proof to add: {pdfText(item.proofToAdd)}{"\n"}Suggested framing: {pdfText(item.suggestedFraming)}</Text></View></View>)}
      <View style={styles.divider} />
      <Text style={styles.sectionLabel}>30-day action plan</Text>
      <View style={[styles.factorGrid, { marginTop: 8 }]}>{dossier.actionPlan.map((item) => <View style={styles.actionCard} key={item.period} wrap={false}><Text style={styles.evidenceLabel}>{item.period}</Text><Text style={styles.recTitle}>{pdfText(item.focus)}</Text>{item.actions.map((action) => <Text style={styles.muted} key={action}>- {pdfText(action)}</Text>)}</View>)}</View>
      <Footer report={report} />
    </Page>}

    {dossier && <Page size="A4" style={styles.page}>
      <Text style={styles.kicker}>Research appendix</Text>
      <Text style={styles.title}>Sources and limits.</Text>
      {dossier.researchWarnings.map((warning) => <Text style={[styles.muted, { marginBottom: 6 }]} key={warning}>- {pdfText(warning)}</Text>)}
      <View style={styles.divider} />
      {dossier.researchSources.map((source) => <View style={styles.sourceItem} key={source.id} wrap={false}><Text style={styles.evidenceLabel}>{source.id} - {source.sourceType.replaceAll("-", " ")}</Text><Text>{pdfText(source.title)}</Text><Link style={styles.sourceLink} src={source.url}>{source.url}</Link><Text style={styles.muted}>Accessed {new Date(source.accessedAt).toISOString().slice(0, 10)}</Text></View>)}
      <View style={styles.divider} />
      <Text style={styles.sectionLabel}>Methodology and limitations</Text>
      <Text style={styles.methodology}>{pdfText(report.methodology)}{"\n\n"}{pdfText(report.disclaimer)}{"\n\n"}Draft model: {pdfText(report.generation?.draftModel)}. Public research is a time-stamped snapshot and may be incomplete.</Text>
      <Footer report={report} />
    </Page>}
  </Document>;
}
