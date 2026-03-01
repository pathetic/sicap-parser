import React, { useState, useEffect } from "react"
import PropTypes from "prop-types"
import { Text, Box } from "ink"
import prettyMs from "pretty-ms"
import es from "@elastic/elasticsearch"
import PromisePool from "@supercharge/promise-pool"

import { Container, Error, Progress } from "../components"
import { checkDate, getDurationInMilliseconds, yesterday } from "../lib/utils"
import { getAllDaAwardNotices, getPublicDaAwardNotice, getAuthority } from "../lib/sicap-api.js"

const start = process.hrtime()

/// Indexeaza achizitiile directe offline (DAN)
function Offline({ date, host, index, concurrency, archive }) {
  const client = new es.Client({ node: host })

  const [total, setTotal] = useState(0)
  const [current, setCurrent] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const [isLoading, setLoading] = useState(false)

  const error = checkDate(date)

  const processDay = async () => {
    const [dd, mm, yyyy] = date.split("-")
    setLoading(true)
    const result = await getAllDaAwardNotices(`${yyyy}-${mm}-${dd}`, { istoric: archive })
    setTotal(result.total)
    setLoading(false)

    if (result.total === 0) return

    await new PromisePool()
      .for(result.items)
      .withConcurrency(concurrency)
      .process(async (item) => {
        const { daAwardNoticeId } = item

        const daAwardNotice = await getPublicDaAwardNotice(daAwardNoticeId, { istoric: archive })

        const authority = await getAuthority(daAwardNotice.contractingAuthorityID, {
          istoric: archive,
          client,
        })

        const doc = {
          item,
          daAwardNotice,
          authority,
          istoric: archive,
        }

        await client
          .update({
            id: daAwardNoticeId,
            retry_on_conflict: 3,
            index,
            body: {
              doc,
              doc_as_upsert: true,
            },
          })
          .catch((error) => {
            console.error(error)
            console.info(
              `-----> UPDATE ERROR ON: [${daAwardNoticeId}]|${date} \n`,
              error.meta.body.error
            )
            process.exit(1)
          })

        setElapsed(prettyMs(getDurationInMilliseconds(start), { secondsDecimalDigits: 0 }))
        setCurrent((c) => c + 1)
      })
  }

  useEffect(() => {
    processDay()
  }, [])

  const percent = current / total || 0
  return (
    <Container>
      {error ? (
        <Error text={error} />
      ) : (
        <Box>
          <Text>{date} | </Text>
          <Progress percent={percent} />
          <Box marginLeft={2}>
            <Text>
              {`| ${Math.round(percent * 100)}% | `}
              {current}/
              {!isLoading ? (
                total
              ) : (
                <Text color="green">...</Text>
              )}{" "}
              | {elapsed}
            </Text>
          </Box>
        </Box>
      )}
    </Container>
  )
}

Offline.propTypes = {
  /// Data in format zz-ll-aaaa - default ziua precedenta
  date: PropTypes.string,
  /// Url Elasticsearch (default localhost:9200)
  host: PropTypes.string,
  /// Indexul Elasticsearch folosit pentru achizitiile offline (default achizitii-offline)
  index: PropTypes.string,
  /// Numarul de accesari concurente spre siteul SEAP (default 5)
  concurrency: PropTypes.number,
  /// foloseste arhiva istorica (baza de date 2007-2018)
  archive: PropTypes.bool,
}

Offline.defaultProps = {
  host: "http://localhost:9200",
  index: "achizitii-offline",
  concurrency: 5,
  archive: false,
  date: yesterday(),
}

Offline.shortFlags = {
  date: "d",
  host: "h",
  index: "i",
  concurrency: "c",
  archive: "a",
}

export default Offline
