export const APPWRITE_COUNT_LIMIT = 5000;
const PAGE_SIZE = 100;

interface AppwritePage {
  items: unknown[];
  total: number;
}

export function appwriteHasMore(offset: number, page: AppwritePage): boolean {
  return (
    offset + page.items.length < page.total ||
    (page.total >= APPWRITE_COUNT_LIMIT && page.items.length === PAGE_SIZE)
  );
}

export function appwriteTotal(page: AppwritePage): string {
  return page.total >= APPWRITE_COUNT_LIMIT ? `≥ ${APPWRITE_COUNT_LIMIT}` : String(page.total);
}
