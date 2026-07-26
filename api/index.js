/*
 * Vstupný bod pre Vercel. Statiku obsluhuje CDN z public/, sem sa dostanú
 * len požiadavky na /api/*, takže sa tu nemontuje express.static.
 */
import { app, mountErrors } from '../server/app.js';

mountErrors();

export default app;
