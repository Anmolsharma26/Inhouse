import { io } from 'socket.io-client';

let socket;
export function connectSocket(token) {
  // Reuse the existing socket (even while it is still connecting) unless the token changed;
  // creating a second one leaves Chat's listeners on a stale socket.
  if (socket && socket.auth?.token === token) return socket;
  socket?.disconnect();
  socket = io('/', { auth: { token } }); // proxied to the API in dev
  return socket;
}
export const getSocket = () => socket;
export function disconnectSocket() { socket?.disconnect(); socket = undefined; }
