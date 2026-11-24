import { io } from 'socket.io-client';

let socket;
export function connectSocket(token) {
  if (socket?.connected) return socket;
  socket = io('/', { auth: { token } }); // proxied to the API in dev
  return socket;
}
export const getSocket = () => socket;
export function disconnectSocket() { socket?.disconnect(); socket = undefined; }
