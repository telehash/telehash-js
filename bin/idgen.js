#!/usr/bin/env node

var telehash = require('..');

telehash.generate(function(err, id){
  if(err) return console.error(err);
  telehash.mesh({id:id}, function(err, mesh){
    if(err) return console.error(err);
    console.log("SUCCESS",mesh.uri(),mesh.json());
  });
});



