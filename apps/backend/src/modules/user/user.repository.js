export const userRepository = {
  async findById(id) {
    return { id, email: "user@example.com", role: "user", displayName: "Demo User" };
  },

  async updateById(id, payload) {
    return { id, ...payload };
  },
};
