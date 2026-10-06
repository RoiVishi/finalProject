/**
 * Auth endpoints — backend/src/auth/auth.controller.ts.
 * Contract (read from the backend, not changed by the frontend):
 *   POST /auth/register                 RegisterDto            -> { access_token }   409 duplicate email
 *   POST /auth/login                    { email, password }    -> { access_token }   401 same message for every failure
 *   POST /auth/password-reset/request   { email }              -> 202 always (no user enumeration)
 *   POST /auth/password-reset/confirm   { token, password }    -> 204                400 invalid / expired / used link
 */
export function authApi(client) {
  return {
    login: (email, password) => client.post('/auth/login', { email: email.trim(), password }),

    register: ({ email, password, fullName, phone, profession, inviteToken }) =>
      client.post('/auth/register', {
        email: email.trim(),
        password,
        fullName: fullName.trim(),
        phone: phone.trim(),
        profession,
        ...(inviteToken ? { inviteToken } : {}),
      }),

    requestPasswordReset: (email) => client.post('/auth/password-reset/request', { email: email.trim() }),

    confirmPasswordReset: (token, password) =>
      client.post('/auth/password-reset/confirm', { token, password }),
  };
}
