import { getDictionaryEntries } from "@/lib/db/dictionary/service";

export default async function Page() {
  const entries = await getDictionaryEntries("apple", ["antonyms", "derived"]);
  return <pre>{JSON.stringify(entries, null, 2)}</pre>;
}
