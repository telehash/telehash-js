var expect = require('chai').expect;
var router = require('../bin/router.js');

describe('router', function(){

  it('should export an object', function(){
    expect(router).to.be.an('object');
  });

});
