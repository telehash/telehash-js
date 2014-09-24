var expect = require('chai').expect;
var stream = require('../../lib/stream.js');

describe('telehash/stream', function(){

  it('should export an extension', function(){
    expect(stream).to.be.a('object');
    expect(stream.name).to.be.equal('stream');
    expect(stream.mesh).to.be.a('function');
  });

  it('should create a new extension', function(){
    stream.mesh({}, function(err, ext){
      expect(err).to.not.exist;
      expect(ext).to.be.a('object');
      expect(ext.open).to.be.a('object');
      expect(ext.open.stream).to.be.a('function');
      expect(ext.link).to.be.a('function');
    });
  });

});
