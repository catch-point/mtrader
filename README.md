# ptrading
Technical Market Data Analysis Tool data uses Yahoo! financial data and other
sources to retreive and manipulate data locally for personal use.

## Instalation

> npm install ptrading/ptrading -g

## Usage

ptrading can be used as a node.js library, as a command line utility or as an interactive shell. All shell commands include a coresponding help command that explains the available arguments and features with some usage documentation.

```
const ptrading = require('ptrading');

// lookup exchange for a symbol and search for similar symbols
ptrading.lookup({symbol: 'YHOO'}).then(suggestions => {
  suggestions.forEach(suggestion => {
    console.log(suggestion.symbol, suggestion.exchange); // YHOO NASDAQ
  });
});

// fetch day, week, month, quarter, or year historic data about a symbol
ptrading.fetch({
  interval: 'day',
  symbol: 'YHOO',
  exchange: 'NASDAQ',
  reverse: true
}).then(bars => {
  bars.forEach(bar => {
    console.log(bar.ending, bar.open, bar.high, bar.low, bar.close, bar.volume);
  });
});

// set storage location for computations
ptrading.config('prefix', '/tmp/ptrading');

// retrieve historic data using custom columns and filtering
ptrading.quote({
  symbol: 'YHOO',
  exchange: 'NASDAQ',
  pad_begin: 9,       // Show today and nine earlier trading days
  columns: [
      'DATE(ending) AS "Date"',
      'day.close AS "Close"',
      '(day.close - OFFSET(1, day.close))*100/OFFSET(1,day.close) AS "Change"'
  ].join(','),
  criteria: 'day.close > OFFSET(1, day.close)'
}).then(bars => {
  bars.forEach(bar => {
    console.log(bar.Date, bar.Close, bar.Change);
  });
});
```
