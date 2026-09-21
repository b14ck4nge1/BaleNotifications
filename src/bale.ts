import {
  integer,
  nested,
  parseProto,
  stringValue,
  type ProtoFields,
} from "./protobuf.ts";

export interface BaleIncomingMessage {
  chatType: number;
  chatId: string;
  senderId: string;
  messageId: string;
  date: string;
  text: string;
  contentKind: "text" | "document" | "other";
}

function requiredNested(fields: ProtoFields, number: number): ProtoFields | undefined {
  try {
    return nested(fields, number);
  } catch {
    return undefined;
  }
}

function describeContent(content: ProtoFields): Pick<BaleIncomingMessage, "text" | "contentKind"> {
  const textMessage = requiredNested(content, 15);
  const text = textMessage ? stringValue(textMessage, 1)?.trim() : undefined;
  if (text) return { text, contentKind: "text" };

  const document = requiredNested(content, 4);
  if (document) {
    const caption = requiredNested(document, 8);
    const captionText = caption ? stringValue(caption, 1)?.trim() : undefined;
    const mime = stringValue(document, 5)?.trim();
    return {
      text: captionText ? `[Attachment] ${captionText}` : `[Attachment${mime ? `: ${mime}` : ""}]`,
      contentKind: "document",
    };
  }

  return { text: "[New Bale message]", contentKind: "other" };
}

export function decodeBaleIncomingMessage(data: Uint8Array): BaleIncomingMessage | null {
  try {
    // Response(2=update) -> UpdateField(1=body) -> UpdateBody(1=event)
    // -> Update(55=incoming message) -> Message.
    const response = parseProto(data);
    const updateField = requiredNested(response, 2);
    const updateBody = updateField && requiredNested(updateField, 1);
    const update = updateBody && requiredNested(updateBody, 1);
    const message = update && requiredNested(update, 55);
    if (!message) return null;

    const chat = requiredNested(message, 1);
    const content = requiredNested(message, 5);
    const chatType = chat && integer(chat, 1);
    const chatId = chat && integer(chat, 2);
    const senderId = integer(message, 2);
    const date = integer(message, 3);
    const messageId = integer(message, 4);
    if (
      !content ||
      chatType === undefined ||
      chatId === undefined ||
      senderId === undefined ||
      date === undefined ||
      messageId === undefined
    ) {
      return null;
    }

    return {
      chatType: Number(chatType),
      chatId: chatId.toString(),
      senderId: senderId.toString(),
      messageId: messageId.toString(),
      date: date.toString(),
      ...describeContent(content),
    };
  } catch {
    return null;
  }
}

export function chatTypeName(type: number): string {
  return (
    {
      1: "Private",
      2: "Group",
      3: "Channel",
      4: "Bot",
      5: "Supergroup",
    } as Record<number, string>
  )[type] ?? `Chat ${type}`;
}

export function messageKey(message: BaleIncomingMessage): string {
  return `${message.chatType}:${message.chatId}:${message.messageId}:${message.date}`;
}

