import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import api, { errMsg } from '../api/client';
import { connectSocket, disconnectSocket } from '../socket';

export const login = createAsyncThunk('auth/login', async (creds, { rejectWithValue }) => {
  try {
    const { data } = await api.post('/auth/login', creds);
    localStorage.setItem('token', data.token);
    connectSocket(data.token);
    return data.user;
  } catch (e) { return rejectWithValue(errMsg(e)); }
});

export const loadMe = createAsyncThunk('auth/me', async () => {
  const { data } = await api.get('/auth/me');
  connectSocket(localStorage.getItem('token'));
  return data.user;
});

const slice = createSlice({
  name: 'auth',
  initialState: { user: null, status: localStorage.getItem('token') ? 'loading' : 'idle', error: null },
  reducers: {
    logout(state) {
      localStorage.removeItem('token');
      disconnectSocket();
      state.user = null; state.status = 'idle';
    },
  },
  extraReducers: (b) => {
    b.addCase(login.pending, (s) => { s.status = 'loading'; s.error = null; })
      .addCase(login.fulfilled, (s, a) => { s.user = a.payload; s.status = 'ready'; })
      .addCase(login.rejected, (s, a) => { s.status = 'idle'; s.error = a.payload; })
      .addCase(loadMe.fulfilled, (s, a) => { s.user = a.payload; s.status = 'ready'; })
      .addCase(loadMe.rejected, (s) => { s.user = null; s.status = 'idle'; });
  },
});

export const { logout } = slice.actions;
export default slice.reducer;
