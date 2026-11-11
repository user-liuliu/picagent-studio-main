import type { StorageAdapter, StorageObject } from "../types.js";

export class MemoryStorage implements StorageAdapter {
  private objects = new Map<string, StorageObject>();
  async put(object: StorageObject) { this.objects.set(object.key, object); }
  async get(key: string) { return this.objects.get(key) ?? null; }
  async previewUrl(key: string) { return `/api/storage/${encodeURIComponent(key)}`; }
  async delete(key: string) { this.objects.delete(key); }
  keys() { return [...this.objects.keys()]; }
}
