import type { AppContext } from "../../server-context";
import { isValidBucketName } from "../naming";
import { listAllMyBucketsXml } from "../xml";

export async function handleListBuckets(
  ctx: AppContext,
  workspaceId: number,
): Promise<Response> {
  const entries = await ctx.listCache.getOrFetch(null, () =>
    ctx.drime.listFolder(null, workspaceId),
  );
  const buckets = entries
    .filter((e) => e.is_folder && isValidBucketName(e.name))
    .map((e) => ({
      name: e.name,
      creationDate: e.updated_at ?? new Date(0).toISOString(),
    }));
  const xml = listAllMyBucketsXml({
    ownerId: "drime",
    ownerDisplayName: "drime",
    buckets,
  });
  return new Response(xml, {
    status: 200,
    headers: { "Content-Type": "application/xml" },
  });
}
