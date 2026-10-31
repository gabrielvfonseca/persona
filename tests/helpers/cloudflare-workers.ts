// Stand-in for the Workers runtime module, so the Worker entry can be imported in Node.
export class DurableObject {
  constructor(
    readonly ctx: unknown,
    readonly env: unknown,
  ) {}
}
