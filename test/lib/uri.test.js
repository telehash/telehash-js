var expect = require('chai').expect;
var URIlib = require('../../lib/uri.js');

describe('URI', function(){

  it('should export encode/decode', function(){
    expect(URIlib).to.be.an('object');
    expect(URIlib.encode).to.be.a('function');
    expect(URIlib.decode).to.be.a('function');
  });

  it('should decode', function(){
    var uri = URIlib.decode('foo://user.xx@bar:1/sess?0a=test&1a=foo&2a=bar#token');
    expect(uri).to.be.an('object');
    expect(uri.protocol).to.be.equal('foo');
    expect(uri.user).to.be.equal('user.xx');
    expect(uri.address).to.be.equal('bar');
    expect(uri.port).to.be.equal(1);
    expect(uri.session).to.be.equal('sess');
    expect(uri.keys).to.be.an('object');
    expect(Object.keys(uri.keys).length).to.be.equal(3);
    expect(uri.token).to.be.equal('token');
    expect(Object.keys(uri.paths).length).to.be.above(2);
  });

  it('should decode', function(){
    var uri = URIlib.encode({
  protocol: 'foo',
  user: 'user.x',
  address: 'bar',
  port: 1,
  session: 'sess',
  keys: {
    '0a': 'test',
    '1a': 'foo',
    '2a': 'bar'
  },
  token: 'token'
});
    expect(uri).to.be.a('string');
    expect(uri).to.be.equal('foo://user.x@bar:1/sess?0a=test&1a=foo&2a=bar#token')
  });

});
