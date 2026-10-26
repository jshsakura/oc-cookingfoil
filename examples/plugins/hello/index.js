// The smallest plugin: it answers every metadata request with nothing, so the next source fills the item.
export default {
  async start(ctx) {
    ctx.log.info("hello started");
  },
  async stop() {},
  async metadata() {
    return null;
  },
};
