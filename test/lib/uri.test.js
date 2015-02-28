var expect = require('chai').expect;
var urilib = require('../../lib/uri.js');

describe('URI', function(){

  it('should export encode/decode', function(){
    expect(urilib).to.be.an('object');
    expect(urilib.check).to.be.a('function');
    expect(urilib.decode).to.be.a('function');
  });

  it('should add paths', function(){
    var paths = [
    {
        "url": "http://192.168.0.36:42424",
        "type": "http"
    },
    {
        "ip": "192.168.0.36",
        "port": 42424,
        "type": "udp4"
    },
    {
        "ip": "fe80::bae8:56ff:fe43:3de4",
        "port": 42424,
        "type": "tcp6"
    }
];
    var uri = urilib.paths('proto://host/path?key=value#frag',paths);
    expect(uri).to.be.equal('proto://host/path?key=value&paths=pmrhk4tmei5ce2duorydulzpge4telrrgy4c4mbogm3dunbsgqzdiirmej2hs4dfei5ce2duoryce7i&paths=pmrgs4bchirdcojsfyytmobogaxdgnrcfqrha33soqrdunbsgqzdilbcor4xazjchirhkzdqgqrh2&paths=pmrgs4bchirgmzjyga5duytbmu4dunjwmztduztfgqztum3emu2celbcobxxe5bchi2denbsgqwce5dzobsseorcorrxanrcpu#frag');
  });

  it('should decode', function(){
    var uri = urilib.decode('foo://bar:1/path?cs0a=test&cs1a=foo&cs2a=bar&paths=pmrgs4bchirdcojsfyytmobogaxdgnrcfqrha33soqrdunbsgqzdilbcor4xazjchirhkzdqgqrh2#rdcojsfyytmobogaxdgnrcfqrha');
    expect(uri).to.be.an('object');
    expect(uri.protocol).to.be.equal('foo:');
    expect(parseInt(uri.port)).to.be.equal(1);
    expect(uri.keys).to.be.an('object');
    expect(Object.keys(uri.keys).length).to.be.equal(3);
    expect(Array.isArray(uri.paths)).to.be.true;
    expect(uri.paths.length).to.be.equal(4);
    expect(uri.fragment.length).to.be.equal(16);
  });

  it('should add keys', function(){
    var keys = {
      '0a': 'test',
      '1a': 'foo',
      '2a': 'bar'
    };
    var uri = urilib.keys('http://foo/', keys);
    expect(uri).to.be.a('string');
    expect(uri).to.be.equal('http://foo/?cs0a=test&cs1a=foo&cs2a=bar')
  });

  it('should add a fragment', function(){
    var uri = urilib.fragment('http://foo/', 'uvabrvfqacyvgcu8kbrrmk9apjbvgvn2wjechqr3vf9c1zm3hv7g',new Buffer('8cc52041a2148541','hex'));
    expect(uri).to.be.a('string');
    expect(uri).to.be.equal('http://foo/#rtcsaqnccscuclgbt6nro6rnka')
  });

  it('should check a fragment', function(){
    var valid = urilib.check('http://foo/#rtcsaqnccscuclgbt6nro6rnka', 'uvabrvfqacyvgcu8kbrrmk9apjbvgvn2wjechqr3vf9c1zm3hv7g');
    expect(valid).to.be.true;
  });

});
