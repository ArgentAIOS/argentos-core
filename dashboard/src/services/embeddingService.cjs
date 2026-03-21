const OpenAI = require("openai");
const fs = require("fs");
const path = require("path");

// Load API key from ~/.api_keys or environment
let OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!OPENAI_API_KEY) {
  try {
    const apiKeysPath = path.join(process.env.HOME, ".api_keys");
    const apiKeysContent = fs.readFileSync(apiKeysPath, "utf-8");
    const match = apiKeysContent.match(/OPENAI_API_KEY[=:]\s*["']?([^"'\n]+)["']?/);
    if (match) {
      OPENAI_API_KEY = match[1].trim();
    }
  } catch (err) {
    console.error("[Embedding] Could not load OpenAI API key:", err.message);
  }
}

const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

// Generate embedding for text
async function generateEmbedding(text) {
  if (!openai) {
    console.warn("[Embedding] OpenAI not configured, skipping embedding");
    return null;
  }

  try {
    // Truncate to ~8000 tokens max (rough estimate: 1 token ≈ 4 chars)
    const truncatedText = text.slice(0, 32000);

    const response = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: truncatedText,
    });

    return response.data[0].embedding;
  } catch (err) {
    console.error("[Embedding] Failed to generate embedding:", err.message);
    return null;
  }
}

// Auto-generate tags based on content
async function generateTags(doc) {
  if (!openai) {
    console.warn("[Embedding] OpenAI not configured, using fallback tags");
    return fallbackTags(doc);
  }

  try {
    const prompt = `Analyze this document and generate 3-5 relevant tags (single words or short phrases).
Document type: ${doc.type}
Title: ${doc.title}
Content preview: ${doc.content.slice(0, 1000)}

Return ONLY a JSON array of tags, nothing else. Example: ["code", "typescript", "api", "backend"]`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 100,
    });

    const tagsText = response.choices[0].message.content.trim();
    const tags = JSON.parse(tagsText);

    console.log("[Embedding] Generated tags:", tags);
    return tags;
  } catch (err) {
    console.error("[Embedding] Failed to generate tags:", err.message);
    return fallbackTags(doc);
  }
}

// Fallback tagging (rule-based)
function fallbackTags(doc) {
  const tags = [];

  // Type-based tags
  tags.push(doc.type);

  // Language-based
  if (doc.language) {
    tags.push(doc.language);
  }

  // Content-based (simple keyword matching)
  const content = (doc.title + " " + doc.content).toLowerCase();

  if (content.includes("error") || content.includes("bug")) tags.push("debugging");
  if (content.includes("api") || content.includes("endpoint")) tags.push("api");
  if (content.includes("database") || content.includes("sql")) tags.push("database");
  if (content.includes("test") || content.includes("spec")) tags.push("testing");
  if (content.includes("deploy") || content.includes("production")) tags.push("deployment");
  if (content.includes("function") || content.includes("class")) tags.push("code");
  if (content.includes("report") || content.includes("analysis")) tags.push("report");
  if (content.includes("documentation") || content.includes("readme")) tags.push("docs");

  // Dedupe and limit to 5
  return [...new Set(tags)].slice(0, 5);
}

// Generate embedding for a search query
async function generateQueryEmbedding(query) {
  return generateEmbedding(query);
}

// Process document: generate embedding + tags
async function processDocument(doc) {
  console.log("[Embedding] Processing document:", doc.title);

  const combinedText = `${doc.title}\n\n${doc.content}`;

  const [embedding, tags] = await Promise.all([generateEmbedding(combinedText), generateTags(doc)]);

  return { embedding, tags };
}

module.exports = {
  generateEmbedding,
  generateTags,
  generateQueryEmbedding,
  processDocument,
};
