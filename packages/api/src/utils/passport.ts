import passport from 'passport';
import { Strategy as LocalStrategy } from 'passport-local';

import { findUserById } from '@/controllers/user';
import { getDatastore } from '@/datastore';
import User from '@/models/user';

import logger from './logger';

passport.serializeUser(function (user, done) {
  done(null, (user as any)._id);
});

passport.deserializeUser(function (id: string, done) {
  findUserById(id)
    .then(user => {
      if (user == null) {
        // The session outlived the user, e.g. the account was deleted. That is
        // not a server fault, and reporting it as one turned every request
        // still carrying the cookie into a 500, public routes included, so the
        // browser could not even reach the login page. `false` is passport's
        // "no such user" signal: the request continues unauthenticated.
        return done(null, false);
      }
      done(null, user);
    })
    .catch(done);
});

// Mongo keeps passport-local-mongoose's authenticate (hash format and lockout
// behavior); Postgres verifies against the datastore's own hash columns.
const passportLocalMongooseAuthenticate = (User as any).authenticate();

const authenticate = async (username: string, password: string) => {
  const datastore = getDatastore();
  if (datastore.backend === 'postgres') {
    return datastore.users.authenticate(username, password);
  }
  return passportLocalMongooseAuthenticate(username, password);
};

passport.use(
  new LocalStrategy(
    {
      usernameField: 'email',
    },
    async function (username, password, done) {
      try {
        const { user, error } = await authenticate(username, password);
        if (error) {
          logger.info({
            message: `Login for "${username}" failed, ${error}"`,
            type: 'user_login',
            authType: 'password',
          });
        }
        return done(null, user, error);
      } catch (err) {
        logger.error({ err, username }, 'Login failed with error');
        return done(err);
      }
    },
  ),
);

export default passport;
