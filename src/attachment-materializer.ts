import type { ModelProfile } from "./config.js";
import type { ChatMessage, ContentPart } from "./llm.js";
import {
  createModelProfileAdapter,
  negotiateModelProviderCapabilities,
  type ModelProviderCapabilityId,
} from "./model-provider.js";
import type { AttachmentReader, AttachmentRecord, AttachmentReferencePart } from "./attachment-store.js";

const MAX_INLINE_TEXT_BYTES = 256 * 1024;

export class AttachmentMaterializationError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "AttachmentMaterializationError";
    this.code = code;
    this.details = details;
  }
}

export function materializeAttachmentMessages(
  messages: ChatMessage[],
  store: AttachmentReader,
  profile: ModelProfile,
): ChatMessage[] {
  const records = new Map<string, AttachmentRecord>();
  const capabilities = new Set<ModelProviderCapabilityId>(["input.text"]);

  for (const message of messages) {
    if (!Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (part.type !== "attachment_ref") continue;
      if (message.role !== "user") {
        throw new AttachmentMaterializationError("attachment_role_invalid", "Only user messages may contain attachment references.");
      }
      const record = store.get(part.attachment.id);
      if (!record) throw new AttachmentMaterializationError("attachment_not_found", `Attachment ${part.attachment.name || part.attachment.id} no longer exists.`, { id: part.attachment.id });
      if (record.sha256 !== part.attachment.sha256) {
        throw new AttachmentMaterializationError("attachment_reference_invalid", `Attachment ${record.name} metadata does not match the stored record.`, { id: record.id });
      }
      records.set(record.id, record);
      if (record.kind === "image") capabilities.add("input.image");
      else if (record.kind === "pdf") capabilities.add("input.pdf");
      else if (record.kind === "file") capabilities.add("input.file");
    }
  }

  const descriptor = createModelProfileAdapter(profile).descriptor;
  const negotiation = negotiateModelProviderCapabilities(descriptor, { capabilities: Array.from(capabilities) });
  if (!negotiation.ok) {
    const issue = negotiation.unsupported[0];
    throw new AttachmentMaterializationError(
      "attachment_capability_unsupported",
      `The selected model cannot accept this attachment: ${issue?.message || "unsupported input"}.`,
      { providerId: descriptor.id, capability: issue?.capability },
    );
  }

  return messages.map((message) => ({
    ...message,
    tool_calls: message.tool_calls?.map((call) => ({ ...call, function: { ...call.function } })),
    content: Array.isArray(message.content)
      ? message.content.flatMap((part) => materializePart(part, records, store))
      : message.content,
  }));
}

function materializePart(
  part: ContentPart,
  records: Map<string, AttachmentRecord>,
  store: AttachmentReader,
): Exclude<ContentPart, AttachmentReferencePart>[] {
  if (part.type !== "attachment_ref") return [cloneProviderPart(part)];
  const record = records.get(part.attachment.id);
  if (!record) throw new AttachmentMaterializationError("attachment_not_found", "Attachment no longer exists.", { id: part.attachment.id });
  const read = store.read(record.id);

  if (record.kind === "image") {
    return [{ type: "image_url", image_url: { url: `data:${record.mimeType};base64,${read.data.toString("base64")}` } }];
  }
  if (record.kind === "text") {
    if (read.data.length > MAX_INLINE_TEXT_BYTES) {
      throw new AttachmentMaterializationError(
        "attachment_text_too_large",
        `Text attachment ${record.name} exceeds the ${MAX_INLINE_TEXT_BYTES / 1024} KiB inline limit.`,
        { id: record.id, size: read.data.length },
      );
    }
    return [{ type: "text", text: `\n\nAttachment: ${record.name}\nSHA-256: ${record.sha256}\n\n${read.data.toString("utf8")}` }];
  }

  throw new AttachmentMaterializationError(
    "attachment_transport_unavailable",
    `The selected provider does not expose a compatible ${record.kind === "pdf" ? "PDF" : "file"} attachment transport.`,
    { id: record.id, kind: record.kind },
  );
}

function cloneProviderPart(part: Exclude<ContentPart, AttachmentReferencePart>): Exclude<ContentPart, AttachmentReferencePart> {
  if (part.type === "text") return { type: "text", text: part.text };
  return { type: "image_url", image_url: { url: part.image_url.url } };
}
