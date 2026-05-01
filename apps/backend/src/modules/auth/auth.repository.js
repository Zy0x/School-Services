const demoUsers = new Map();

export const authRepository = {
  async findByEmail(email) {
    return demoUsers.get(email) || null;
  },

  async saveDemoUser(user) {
    demoUsers.set(user.email, user);
    return user;
  },
};
