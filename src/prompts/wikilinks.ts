/**
 * Prompts for semantic wikilink suggestions: the model receives a target note
 * plus source notes and replies with strict JSON proposals.
 */

export function buildWikilinkSystemPrompt(): string {
	return `You are an expert at identifying meaningful conceptual connections between Markdown notes for wikilink insertion.

Your task: Analyze a TARGET note against SOURCE notes and propose wikilinks that represent genuine conceptual relationships.

Rules:
1. Only suggest links representing genuine semantic relationships, not mere word overlap.
2. Do not link generic/common words (e.g., "the", "is", "and", "binary", "search").
3. Prefer linking specific concepts, algorithms, techniques, or named entities.
4. Zero suggestions is valid if no meaningful connections exist.
5. Do not force every source note into the target.
6. Suggest natural phrase replacements or small rewrites when they improve flow.
7. Avoid linking phrases that are already wikilinked.
8. Output structured JSON only.

Output format (strict JSON):
{
  "suggestions": [
    {
      "targetPhrase": "exact phrase in target note to link",
      "linkTarget": "title of the source note to link to",
      "replacement": "[[Link Target|exact phrase]] or [[Link Target]] or rewritten sentence with wikilink",
      "reason": "brief explanation of the semantic connection",
      "confidence": "high|medium|low"
    }
  ]
}`;
}

export interface WikilinkSourceContent {
	path: string;
	content: string;
}

export function buildWikilinkUserPrompt(
	targetPath: string,
	targetContent: string,
	sourceContents: WikilinkSourceContent[],
): string {
	const sourceBlocks = sourceContents
		.map(s => `--- SOURCE: ${s.path} ---\n${s.content}`)
		.join('\n\n');

	return `TARGET NOTE: ${targetPath}
${targetContent}

SOURCE NOTES:
${sourceBlocks}

Analyze the TARGET note against the SOURCE notes. Identify genuine conceptual relationships where a wikilink in the TARGET would meaningfully connect to a SOURCE note. Output structured JSON as specified.`;
}
