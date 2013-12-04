Command-line telehash fieldtest utility
=======================================

Just run `node tft.js` and the first time it runs it will ask you for a nickname and store your identity in ./id.json (which can be overridden with `--id ./foo.json`).

Once running you will have a command line to look at the DHT, seek, ping, send test messages to other instances, create groups, etc. Type `help` to see a list of commands.  All debug output is saved in ./debug.log.