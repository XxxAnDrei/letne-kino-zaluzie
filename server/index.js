// Musí byť prvý import — napĺňa process.env skôr, než si ho prečíta db.js a auth.js.
import { envLoaded } from './env.js';

import { app, mountStatic, mountErrors } from './app.js';
import { isRemote } from './db.js';
import { authStartupNotes } from './auth.js';

// Lokálne obsluhuje statiku Express; na Verceli to robí CDN.
mountStatic();
mountErrors();

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`Letné kino Veľké Zálužie — http://localhost:${port}`);
  console.log(`Správca rezervácií      — http://localhost:${port}/spravca`);
  console.log(`Databáza                — ${isRemote ? 'Turso (vzdialená)' : 'lokálny súbor'}`);
  if (envLoaded) console.log(`  načítané z .env: ${envLoaded} premenných`);
  for (const note of authStartupNotes()) console.log(`  ! ${note}`);
});
