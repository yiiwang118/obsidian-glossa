const path = require('path');
exports.run = async (t, load) => {
  const { dataRecord, errorMessage, errorName, scalarText } = await load(path.resolve(__dirname, '../src/utils/unknown_data.ts'));
  t.eq(dataRecord(null), {}, 'null input has no accessible record fields');
  t.eq(dataRecord(['untrusted']), {}, 'arrays are not protocol envelopes');
  const envelope = { known: 'value', extension: { future: true } };
  t.eq(dataRecord(envelope), envelope, 'unknown protocol extensions remain intact');
  t.eq(errorMessage(new Error('Network unavailable')), 'Network unavailable', 'normal Error messages stay unchanged');
  t.eq(errorMessage({ name: 'AbortError', message: 'Stopped' }), 'Stopped', 'cross-window or library error objects retain their message');
  t.eq(errorName({ name: 'AbortError' }), 'AbortError', 'cancellation classification survives typed boundary');
  t.eq(errorMessage({ headers: { Authorization: 'PRIVATE TEST VALUE' } }), '[object Object]', 'unrecognized exception objects cannot expose credential fields');
  for (const value of ['message', 0, false, null, undefined]) t.eq(errorMessage(value), String(value), 'primitive errors keep legacy text');
  t.eq(scalarText({ key: 'value' }), '[object Object]', 'frontmatter object append keeps its original text semantics');
  t.eq(scalarText(['tag', null, ['one', 'two'], false]), 'tag,,one,two,false', 'YAML arrays keep their original string conversion');
  const circular = []; circular.push(circular, 'tail');
  t.eq(scalarText(circular), ',tail', 'cyclic arrays do not overflow while formatting metadata');
};
