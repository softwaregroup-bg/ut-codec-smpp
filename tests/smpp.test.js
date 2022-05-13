const tap = require('tap');
const data = require('./fixture');
const SmppParser = require('..');

tap.test('SMPP messages', async function(t) {
    const parser = new SmppParser({});
    let encodedData = null;
    Object.keys(data.decodeTests).map(function(test) {
        t.test('#Should decode correctly: ' + test, async function(assert) {
            encodedData = parser.decode(data.decodeTests[test].buf, {});
            const {$$: expectedMeta, ...expected} = data.decodeTests[test].data;
            assert.match(encodedData, expected);
        });
    });
    Object.keys(data.encodeTests).map(function(test) {
        t.test('#Should encode correctly: ' + test, async function(assert) {
            const {$$: $meta, ...params} = data.encodeTests[test].data;
            const decodedData = parser.encode(params, $meta);
            assert.same(decodedData.toString(), data.encodeTests[test].buf.toString());
        });
    });
});
