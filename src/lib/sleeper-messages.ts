/** Server-only Sleeper messaging. Never retry a send with an uncertain outcome. */
export class SleeperMessageError extends Error {}

const NOTIFICATION_BOT_ID = "1412094574553280512";
function decodedText(text: string): string {
  if (typeof text !== "string") return "";
  const entities: Record<string, string> = { amp: "&", apos: "'", quot: '"', lt: "<", gt: ">" };
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|apos|quot|lt|gt);/gi, (match, entity: string) => {
    if (!entity.startsWith("#")) return entities[entity.toLowerCase()] ?? match;
    const code = entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
  });
}

export async function sendSleeperDm(recipientId: string, text: string, clientId: string): Promise<void> {
  const token = process.env.SLEEPER_TOKEN?.trim();
  if (!token) throw new SleeperMessageError("Sleeper messaging is not configured.");
  if (!/^\d+$/.test(recipientId)) throw new SleeperMessageError("This team has no valid Sleeper account.");
  // One deadline covers account lookup, conversation lookup and the send.
  const signal = AbortSignal.timeout(15_000);
  async function request<T>(operationName: string, query: string, variables = {}): Promise<T> {
    let response: Response;
    try {
      response = await fetch("https://sleeper.com/graphql", {
        method: "POST",
        headers: { "Content-Type": "application/json", authorization: token!, "x-sleeper-graphql-op": operationName },
        cache: "no-store", signal,
        body: JSON.stringify({ operationName, query, variables }),
      });
    } catch {
      throw new SleeperMessageError("Sleeper did not confirm delivery. Check the DM before sending again.");
    }
    const result = await response.json().catch(() => null);
    if (response.status === 401 || (Array.isArray(result?.errors) && result.errors.some((e: { code?: string }) => e.code === "unauthorized"))) {
      throw new SleeperMessageError("Sleeper rejected the connected account. The commissioner needs to reconnect it.");
    }
    if (!response.ok || result?.errors?.length || !result?.data) {
      throw new SleeperMessageError("Sleeper did not confirm delivery. Check the DM before sending again.");
    }
    return result.data as T;
  }

  const { me } = await request<{ me: { user_id: string } | null }>("me", "query me { me { user_id } }");
  if (!me?.user_id) throw new SleeperMessageError("Sleeper could not identify the connected account.");
  if (String(me.user_id) !== NOTIFICATION_BOT_ID) {
    throw new SleeperMessageError("Connect FranchiseManagerBot to send site notifications.");
  }
  const members = [...new Set([String(me.user_id), recipientId])];
  const { get_dm_by_members: dm } = await request<{ get_dm_by_members: { dm_id: string; dm_type: string } | null }>(
    "get_dm_by_members",
    "query get_dm_by_members($members: [Snowflake]) { get_dm_by_members(members: $members) { dm_id dm_type } }",
    { members },
  );
  if (dm) {
    if (!dm.dm_id || dm.dm_type !== "single") throw new SleeperMessageError("Sleeper did not return a direct conversation.");
    const { create_message: message } = await request<{ create_message: { message_id: string; parent_id: string; author_id: string; text: string } | null }>(
      "create_message",
      `mutation create_message($parent_id: Snowflake!, $parent_type: String!, $text: String, $client_id: String) {
        create_message(parent_id: $parent_id, parent_type: $parent_type, text: $text, client_id: $client_id) {
          message_id parent_id author_id text
        }
      }`,
      { parent_id: dm.dm_id, parent_type: "dm", text, client_id: clientId },
    );
    if (!message?.message_id || String(message.parent_id) !== String(dm.dm_id)
      || String(message.author_id) !== String(me.user_id) || decodedText(message.text) !== text) {
      throw new SleeperMessageError("Sleeper did not confirm delivery. Check the DM before sending again.");
    }
  } else {
    // Create the conversation and its first message together, rather than an empty DM.
    const started = Date.now();
    const { create_dm: created } = await request<{ create_dm: { dm_id: string; dm_type: string; last_message_id: string; last_author_id: string; last_message_text: string } | null }>(
      "create_dm",
      `mutation create_dm($members: [Snowflake], $dm_type: String!, $message_text: String, $client_id: String) {
        create_dm(members: $members, dm_type: $dm_type, message_text: $message_text, client_id: $client_id) {
          dm_id dm_type last_message_id last_author_id last_message_text
        }
      }`,
      // Creation takes only the other member; lookup takes both member IDs.
      { members: [recipientId], dm_type: "single", message_text: text, client_id: clientId },
    );
    if (!created?.dm_id || created.dm_type !== "single") {
      throw new SleeperMessageError("Sleeper did not confirm delivery. Check the DM before sending again.");
    }
    if (created.last_message_id && String(created.last_author_id) === String(me.user_id)
      && decodedText(created.last_message_text) === text) return;
    // Sleeper can return empty last-message metadata while its first message is sent.
    // Read to confirm it; never send a second message to fill that metadata.
    const { messages } = await request<{ messages: { message_id: string; author_id: string; text: string; created: number; client_id: string | null }[] | null }>(
      "messages",
      "query messages($parent_id: Snowflake!) { messages(parent_id: $parent_id, show_hidden: false) { message_id author_id text created client_id } }",
      { parent_id: created.dm_id },
    );
    const matches = Array.isArray(messages) ? messages.filter(message => message.message_id
      && String(message.author_id) === String(me.user_id) && decodedText(message.text) === text
      && (message.client_id == null || message.client_id === clientId)
      && message.created >= started - 5000 && message.created <= Date.now() + 5000) : [];
    if (matches.length !== 1) throw new SleeperMessageError("Sleeper did not confirm delivery. Check the DM before sending again.");
  }
}
