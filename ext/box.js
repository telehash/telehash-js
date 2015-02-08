var streamlib = require('stream');
var lob = require('lob-enc');

// TODO - this is not implemented yet, is just a skeleton
// implements https://github.com/telehash/telehash.org/blob/v3/v3/channels/box.md

exports.name = 'box';

exports.mesh = function(mesh, cbMesh)
{
  var ext = {open:{}};

  // app can set a handler process any incoming inbox messages
  mesh.inbox = function(cbMessage)
  {
    ext.message = cbMessage;
  }
  
  // enable ALL links to have a box w/ us by setting the byte size capacity
  mesh.cap = function(cap)
  {
    ext.cap = cap;
  }

  ext.link = function(link, cbLink)
  {

    // encrypt a message to this link
    link.message = function(message)
    {
      // call link.x.encrypt()
    }

    // ask this link to put this message in the recipients inbox
    link.outbox = function(to, message)
    {
      // open outobox channel and send it
    }
    
    // change the box support/capacity per-link
    link.cap = function(cap)
    {
      link.cap = cap;
    }

    cbLink();
  }

  // handle incoming notifications of waiting messages
  ext.open.boxes = function(args, open, cbOpen){
    cbOpen();
    var link = this;
    // if no ext.message then ignore
    // check each box id to see if it's a link we know
    // then open an inbox for each to collect messages
    // delete messages after valid handler callback
  }

  // handle incoming messages to cache
  ext.open.outbox = function(args, open, cbOpen){
    cbOpen();
    var link = this;
    // check the link and cap, cache if space, drop/ignore if not
  }

  // handle request to get cached messages
  ext.open.inbox = function(args, open, cbOpen){
    cbOpen();
    var link = this;
    // calculate id and return any messages
  }

  cbMesh(undefined, ext);
}