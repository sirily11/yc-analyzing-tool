function errorDetails(error: unknown) {
  const details: string[] = [];
  let current = error;
  for (let depth = 0; depth < 6 && current; depth += 1) {
    if (typeof current === "string") {
      details.push(current);
      break;
    }
    if (current instanceof Error) {
      details.push(current.message);
      current = current.cause;
      continue;
    }
    if (typeof current === "object") {
      const value = current as { message?: unknown; cause?: unknown };
      if (typeof value.message === "string") details.push(value.message);
      current = value.cause;
      continue;
    }
    break;
  }
  return details.join(" ");
}

export function chatToolErrorMessage(error: unknown) {
  const details = errorDetails(error);
  if (details.includes("COMPANY_RESEARCH_CONFIRMATION_REQUIRED")) {
    return "Company research approval was not available for this tool call.";
  }
  if (details.includes("FIRECRAWL_NOT_CONFIGURED")) {
    return "Public company research is not configured on the server yet.";
  }
  if (details.includes("FIRECRAWL_RESEARCH_UNAVAILABLE")) {
    return "No usable live public sources were retrieved for this company research.";
  }
  if (details.includes("YC_COMPANY_NOT_FOUND")) {
    return "One or more selected YC companies are unavailable in the current YC directory.";
  }
  if (details.includes("DOCUMENT_NOT_AVAILABLE")) {
    return "The retained pitch deck is unavailable. Attach the PDF again to analyze that application.";
  }
  return "The requested tool could not complete. Please retry from this conversation.";
}
