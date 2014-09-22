var expect = require('chai').expect;
var telehash = require('../../telehash.js');
var lob = require('lob-enc');
var path = require('../../lib/path.js');

describe('telehash/path', function(){

  it('should export an extension', function(){
    expect(path).to.be.a('object');
    expect(path.name).to.be.equal('path');
    expect(path.mesh).to.be.a('function');
  });

  it('should create a new extension', function(){
    path.mesh({}, function(err, ext){
      expect(err).to.not.exist;
      expect(ext).to.be.a('object');
      expect(ext.open).to.be.a('object');
      expect(ext.open.path).to.be.a('function');
    });
  });

});
