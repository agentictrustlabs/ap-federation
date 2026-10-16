// The Cloudflare runtime types this Worker touches, declared minimally so the app typechecks against the workspace's node types.
interface SqlStorageCursor<T> { toArray(): T[] }
interface SqlStorage { exec<T = Record<string, unknown>>(query: string, ...bindings: unknown[]): SqlStorageCursor<T> }
interface DurableObjectState { storage: { sql: SqlStorage } }
interface DurableObjectId { toString(): string }
interface DurableObjectStub { fetch(input: string | Request, init?: RequestInit): Promise<Response> }
interface DurableObjectNamespace { idFromName(name: string): DurableObjectId; get(id: DurableObjectId): DurableObjectStub }
