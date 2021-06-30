/*
 * Copyright 2020 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

const { executeQuery, executeQueryBatch } = require('../../test-client')

const ANON_PLACEHOLDER = '<anonymous>'
const OPERATION_PREFIX = 'GraphQL/operation/ApolloServer'
const EXTERNAL_PREFIX = 'External'

const { setupFederatedGatewayServerTests } = require('./federated-gateway-server-setup')

setupFederatedGatewayServerTests({
  suiteName: 'fastify segments',
  createTests: createFederatedSegmentsTests
})

/**
 * Creates a set of standard segment naming and nesting tests to run
 * against express-based apollo-server libraries.
 * It is required that t.context.helper and t.context.serverUrl are set.
 * @param {*} t a tap test instance
 */
function createFederatedSegmentsTests(t, frameworkName) {
  const TRANSACTION_PREFIX = `WebTransaction/${frameworkName}/POST`

  t.test('should nest sub graphs under operation', (t) => {
    const { helper, serverUrl } = t.context

    const query = `query {
      libraries {
        branch
        booksInStock {
          isbn,
          title,
          author
        }
        magazinesInStock {
          issue,
          title
        }
      }
    }`

    helper.agent.on('transactionFinished', (transaction) => {
      if (shouldSkipTransaction(transaction)) {
        return
      }

      const libraryExternal = formatExternalSegment(t.context.libraryUrl)
      const bookExternal = formatExternalSegment(t.context.bookUrl)
      const magazineExternal = formatExternalSegment(t.context.magazineUrl)

      const operationPart = `query/${ANON_PLACEHOLDER}`
      const expectedSegments = [{
        name: `${TRANSACTION_PREFIX}//${operationPart}`,
        children: [{
          name: 'Expressjs/Router: /',
          children: [{
            name: 'Nodejs/Middleware/Expressjs/<anonymous>',
            children: [{
              name: `${OPERATION_PREFIX}/${operationPart}`,
              children: [
                { name: libraryExternal },
                { name: bookExternal },
                { name: magazineExternal }
              ]
            }]
          }]
        }]
      }]

      t.segments(transaction.trace.root, expectedSegments)
    })

    executeQuery(serverUrl, query, (err, result) => {
      t.error(err)
      checkResult(t, result, () => {
        t.end()
      })
    })
  })

  t.test('batch query should nest sub graphs under appropriate operations', (t) => {
    const { helper, serverUrl } = t.context

    const booksQueryName = 'GetBooksForLibraries'
    const booksQuery = `query ${booksQueryName} {
      libraries {
        branch
        booksInStock {
          isbn,
          title,
          author
        }
      }
    }`

    const magazineQueryName = 'GetMagazinesForLibraries'
    const magazineQuery = `query ${magazineQueryName} {
      libraries {
        branch
        magazinesInStock {
          issue,
          title
        }
      }
    }`

    const queries = [booksQuery, magazineQuery]

    const libraryExternal = formatExternalSegment(t.context.libraryUrl)
    const bookExternal = formatExternalSegment(t.context.bookUrl)
    const magazineExternal = formatExternalSegment(t.context.magazineUrl)

    helper.agent.on('transactionFinished', (transaction) => {
      if (shouldSkipTransaction(transaction)) {
        return
      }

      const operationPart1 = `query/${booksQueryName}`
      const expectedQuery1Name = `${operationPart1}`
      const operationPart2 = `query/${magazineQueryName}`
      const expectedQuery2Name = `${operationPart2}`

      const batchTransactionPrefix = `${TRANSACTION_PREFIX}//batch`

      const expectedSegments = [{
        name: `${batchTransactionPrefix}/${expectedQuery1Name}/${expectedQuery2Name}`,
        children: [{
          name: 'Expressjs/Router: /',
          children: [{
            name: 'Nodejs/Middleware/Expressjs/<anonymous>',
            children: [
              {
                name: `${OPERATION_PREFIX}/${operationPart1}`,
                children: [
                  { name: libraryExternal },
                  { name: bookExternal }
                ]
              },
              {
                name: `${OPERATION_PREFIX}/${operationPart2}`,
                children: [
                  { name: libraryExternal },
                  { name: magazineExternal }
                ]
              }
            ]
          }]
        }]
      }]

      t.segments(transaction.trace.root, expectedSegments)
    })

    executeQueryBatch(serverUrl, queries, (err, result) => {
      t.error(err)
      checkResult(t, result, () => {
        t.equal(result.length, 2)

        t.end()
      })
    })
  })
}

/**
 * Verify we didn't break anything outright and
 * test is setup correctly for functioning calls.
 */
 function checkResult(t, result, callback) {
  t.ok(result)

  if (result.errors) {
    result.errors.forEach((error) => {
      t.error(error)
    })
  }

  setImmediate(callback)
}

/**
 * Sub-graph transactions are flagged as ignore via 'createIgnoreTransactionPlugin'
 * to indicate we are not intending to check data for those in these tests.
 */
function shouldSkipTransaction(transaction) {
  if (transaction.forceIgnore) {
    return true
  }

  return false
}

function formatExternalSegment(url) {
  const hostAndPort = url.replace('http://', '')
  const name = `${EXTERNAL_PREFIX}/${hostAndPort}`

  return name
}
