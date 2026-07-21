const fs = require('fs');
const path = require('path');

exports.run = async function(t) {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/main.ts'), 'utf8');
  t.ok(
    source.includes('name: cmd.title'),
    'built-in slash commands register their unprefixed titles',
  );
  t.ok(
    !source.includes('name: `Glossa: ${cmd.title}`'),
    'command names do not duplicate the plugin prefix added by the host',
  );
};
