import { error, type RequestHandler } from '@sveltejs/kit'
import { OAuth2Client } from 'google-auth-library'
import { query } from '../../_db';
import { config } from '$lib/config'

// Verify JWT per https://developers.google.com/identity/gsi/web/guides/verify-google-id-token
async function getGoogleUserFromJWT(token: string): Promise<Partial<User>> {
  try {
    const clientId = config.googleClientId
    const client = new OAuth2Client(clientId)
    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: clientId
    });
    const payload = ticket.getPayload()
    if (!payload) throw error(500, 'Google authentication did not get the expected payload')
    
    return {
      firstName: payload['given_name'] || 'UnknownFirstName',
      lastName: payload['family_name'] || 'UnknownLastName',
      email: payload['email']
    }
  } catch (err) {
    let message = ''
    if (err instanceof Error) message = err.message
    throw error(500,`Google user could not be authenticated: ${message}`)
  }
}

// Upsert user and get session ID
async function upsertGoogleUser(user: Partial<User>): Promise<UserSession> {
  try {
    const sql = `SELECT start_gmail_user_session($1) AS user_session;`
    const { rows } = await query(sql, [JSON.stringify(user)])
    return <UserSession> rows[0].user_session
  } catch (err) {
    let message = ''
    if (err instanceof Error) message = err.message
    throw error(500,`Gmail user could not be upserted: ${message}`)
  }
}

// Returns local user if Google user authenticated (and authorized our app)
export const POST: RequestHandler = async event => {
  try {
    const { token } = await event.request.json()
    const user = await getGoogleUserFromJWT(token)
    const userSession = await upsertGoogleUser(user)

    // Prevent hooks.ts's handler() from deleting cookie thinking no one has authenticated
    event.locals.user = userSession.user

    return new Response(JSON.stringify({
      message: 'Successful Google Sign-In.',
      user: userSession.user
    }), {
      headers: {
      'Set-Cookie': `session=${userSession.id}; Path=/; SameSite=Lax; HttpOnly;`}
      }
    )

  } catch (err) {
    let message = ''
    if (err instanceof Error) message = err.message
    throw error(401, message)
  }
}