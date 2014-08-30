var expect = require('chai').expect;
var telehash = require('../index.js');

describe('telehash', function(){

  it('should export an object', function(){
    expect(telehash).to.be.a('object');
  });

});
