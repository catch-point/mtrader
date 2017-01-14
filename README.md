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

## Expressions ##
An expression is any combination of field, constants, and function calls connected by an operator or operators.

A constant can be a number or a quoted string.

A function call has a name followed parentheses enclosed comma separated list of expressions.

A field can be one of the following without a prefix:

```
      symbol    Represents the symbol used by the exchange
      exchange  Represents the exchange acronym
      ending    Represents the dateTime of when an interval ended
```
A field can also be one of the following prefixed by an interval:

```
      <interval>.ending  The dateTime when the interval ends (interval prefix is optional)
      <interval>.open    The price when the interval began
      <interval>.high    The highest price during the interval
      <interval>.low     The lowest price during the interval
      <interval>.close   The price when the interval ended
      <interval>.volume  The volume during the interval
```
An <interval> can be one of the following:

```
      year        List yearly quotes for security
      quarter     List quarterly quotes for security
      month       List monthly quotes for security
      week        List weekly quotes for security
      day         List daily quotes for security
      mX          List intraday quotes for security by X minutes
```
Operators include the following:

```
      OR   0 if both expressions are 0.
      AND  0 if either expression is 0.
      =    0 if both expressions have the same value.
      !=   0 if either expression has a different value.
      <>   0 if either expression has a different value.
      <=   0 if the left expression is larger than the right.
      >=   0 if the right expression is larger than the left.
      <    0 if the left expression is larger than or equal to the right.
      >    0 if the right expression is larger than or equal to the left.
      +    Adds both values together.
      -    Subtracts the right value from the left value.
      *    Multiples the values together.
      /    Divides the right values into the left value.
      %    Returns the integer remainder of a division
      !    0 if the expression was not zero
      ()   Groups expressions together to possibly change their precedence.
```
See the following help commands for function descriptions:
```
    help common-functions  
    help lookback-functions  
    help indicator-functions 
```
