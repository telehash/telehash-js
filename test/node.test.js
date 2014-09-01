var expect = require('chai').expect;
var telehash = require('../node.js');

describe('node-telehash', function(){

  it('should export an object', function(){
    expect(telehash).to.be.a('object');
  });

});
