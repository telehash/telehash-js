var expect = require('chai').expect;
var Pipe = require('../pipe.js').Pipe;

describe('pipe', function(){

  it('should export a factory', function(){
    expect(Pipe).to.be.a('function');
  });

  it('should create new', function(){
    var pipe = new Pipe('test');
    expect(pipe).to.be.an('object');
  });

  it('should call send', function(done){
    var pipe = new Pipe('test');
    pipe.onSend = function(p)
    {
      expect(p).to.be.an('object');
      done();
    }
    pipe.send({});
  });

  it('should do an event', function(done){
    var pipe = new Pipe('test');
    pipe.on('test',function(on,a){
      expect(a).to.be.true;
      expect(this).to.be.equal(pipe);
      done();
    });
    pipe.do('test',true);
  });

});
