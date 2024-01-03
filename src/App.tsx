import React, {useCallback, useEffect, useRef, useState} from 'react';
import './App.css';
import styled from "styled-components";
import { BroadcastChannel } from "broadcast-channel";

const channel = new BroadcastChannel("webrtc")

function App() {

  const identifier = useRef<string>(`${Math.round(Math.random() * 10000)}`)
  const stream = useRef<MediaStream | null>(null)

  const myVideo = useRef<HTMLVideoElement>(null)

  const [sessionEnabled, setSessionEnabled] =
      useState(false)

  const [connections, setConnections] =
      useState<{ [key: string]: [RTCPeerConnection, MediaStream | null] }>({ })

  const connectionsRef =
      useRef<{ [key: string]: [RTCPeerConnection, MediaStream | null] }>({ })

  const signaling = useRef(channel)

  const startSession = useCallback(async () => {
    stream.current = await navigator.mediaDevices.getUserMedia({ audio: true, video: true })
    myVideo.current!.srcObject = stream.current!;
    myVideo.current!.play().catch(console.error);
    signaling.current.postMessage({ from: identifier.current, type: "NewConnection" })
    setSessionEnabled(true)
  }, [])

  const finishSession = useCallback(async () => {
    signaling.current.postMessage({ from: identifier.current, type: "Disconnection" })
    stream.current?.getTracks()?.forEach(it => it.stop())
    Object.values(connectionsRef.current).forEach(it => {
      const [connection, stream] = it as [RTCPeerConnection, MediaStream | null]
      connection.close()
      stream?.getTracks()?.forEach(it => it.stop())
    })
    connectionsRef.current = { }
    setConnections(connectionsRef.current)
    setSessionEnabled(false)
  }, [])

  const getOrPutPeerConnection = useCallback(async (from: string) => {
    let connection = connectionsRef.current[from]?.[0]
    if (!connection) {
      const onCreateIceCandidate = (event: RTCPeerConnectionIceEvent) => {
        signaling.current.postMessage({
          from: identifier.current,
          to: from,
          type: "Candidate",
          candidate: event.candidate?.candidate ?? null,
          sdpMid: event.candidate?.sdpMid ?? null,
          sdpMLineIndex: event.candidate?.sdpMLineIndex ?? null
        })
      }
      const onTrack = (event: RTCTrackEvent) => {
        connectionsRef.current = { ...connectionsRef.current, [from]: [connectionsRef.current[from][0], event.streams[0]] }
        setConnections(connectionsRef.current)
      }
      connection = new RTCPeerConnection()
      connection.addEventListener("icecandidate", onCreateIceCandidate)
      connection.addEventListener("track", onTrack)
      stream.current!.getTracks().forEach(it => connection!.addTrack(it, stream.current!))
      connectionsRef.current = { ...connectionsRef.current, [from]: [connection, null] }
      setConnections(connectionsRef.current)
    }
    return connection
  }, [])

  const getPeerConnection = useCallback((from: string) => connectionsRef.current[from][0]!, [])

  const handleNewConnection = useCallback(async (data: any) => {
    const connection = await getOrPutPeerConnection(data.from)
    const offer = await connection.createOffer()
    await connection.setLocalDescription(offer)
    signaling.current.postMessage({ from: identifier.current, to: data.from, type: "Offer", sdp: offer.sdp }).then()
  }, [getOrPutPeerConnection])

  const handleOffer = useCallback(async (data: any) => {
    const { sdp, from } = data
    const connection = await getOrPutPeerConnection(from)
    await connection.setRemoteDescription({ type: 'offer', sdp })
    const answer = await connection.createAnswer()
    signaling.current.postMessage({ from: identifier.current, to: from, type: "Answer", sdp: answer.sdp }).then()
    await connection.setLocalDescription(answer)
  }, [getOrPutPeerConnection])

  const handleAnswer = useCallback(async (data: any) => {
    const { sdp, from } = data
    const connection = getPeerConnection(from)
    await connection.setRemoteDescription({ type: 'answer', sdp })
  }, [getPeerConnection])

  const handleCandidate = useCallback(async (data: any) => {
    const { candidate, sdpMLineIndex, sdpMid, from } = data
    const connection = getPeerConnection(from)
    if (candidate) await connection.addIceCandidate({ candidate, sdpMLineIndex, sdpMid })
    else await connection.addIceCandidate()
  } ,[getPeerConnection])

  const handleDisconnection = useCallback(async (data: any) => {
    connectionsRef.current = { ...connectionsRef.current }
    delete connectionsRef.current[data.from]
    setConnections(connectionsRef.current)
  }, [])

  const messageHandler = useCallback(async (data: any) => {
    if (!sessionEnabled) return
    if (data.to !== undefined && data.to !== null && data.to !== identifier.current) return

    switch (data.type) {
      case "NewConnection":
        await handleNewConnection(data)
        break;
      case "Offer":
        await handleOffer(data)
        break;
      case "Answer":
        await handleAnswer(data)
        break;
      case "Candidate":
        await handleCandidate(data)
        break;
      case "Disconnection":
        await handleDisconnection(data)
        break;
    }
  }, [handleNewConnection, handleOffer, handleAnswer, handleCandidate, handleDisconnection, sessionEnabled])

  useEffect(() => {
    const signal = signaling.current
    signal.addEventListener("message", messageHandler)

    return () => signal.removeEventListener("message", messageHandler)
  }, [messageHandler])

  return (
    <Root>
      <Connections>
        <ConnectionVideo ref={myVideo}></ConnectionVideo>
        {Object.entries(connections).map(it =>
            <RtcConnectionView key={it[0]} identifier={it[0]} data={it[1]}/>
        )}
      </Connections>
      <ControlButtons>
        {sessionEnabled === false && (
        <ControlButton onClick={startSession} disabled={sessionEnabled}>연결 시작</ControlButton>
        )}
        {sessionEnabled === true && (
        <ControlButton onClick={finishSession} disabled={!sessionEnabled}>연결 종료</ControlButton>
        )}
      </ControlButtons>
    </Root>
  );
}

const RtcConnectionView: React.FC<{ identifier: string, data: [RTCPeerConnection, MediaStream | null] }> = props => {

  const video = useRef<HTMLVideoElement>(null)
  const { data: [, stream] } = props

  useEffect(() => {
    if (!video.current) return
    video.current.srcObject = stream
    video.current.play().then().catch(console.error)
  }, [stream]);

  return (
      <ConnectionVideo ref={video}></ConnectionVideo>
  )
}

const Root = styled.div`
  width: 100vw;
  height: 100vh;
  position: absolute;
`

const ControlButton = styled.button`
  width: 200px;
  height: 50px;
  border: 0;
  font-size: 25px;
  color: white;
  border-radius: 10px;
  margin: 15px;
  cursor: pointer;
  transition: .25s all;
  color: #202020;
  
  &:hover {
    background-color: #303030;
    color: white;
    
  }
`

const ControlButtons = styled.div`
  display: flex;
  justify-content: center;
  flex-direction: row;
  flex-wrap: wrap;
  margin: 30px;
`

const ConnectionVideo = styled.video`
  width: 500px;
  border-radius: 30px;
  aspect-ratio: 4 / 3;
  object-fit: cover;
  margin-top: 5%;
  margin-left: 15px;
  margin-right: 15px;
`

const Connections = styled.div`
  width: 100vw;
  display: flex;
  justify-content: center;
  flex-direction: row;
  flex-wrap: wrap;
`

export default App;
