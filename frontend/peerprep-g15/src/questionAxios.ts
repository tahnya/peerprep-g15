import axios, { type AxiosInstance } from 'axios';

const questionAxios: AxiosInstance = axios.create({
    baseURL: 'http://localhost:3002',
    timeout: 10000,
    withCredentials: true,
});

questionAxios.interceptors.request.use((config) => {
    const accessToken = localStorage.getItem('accessToken');

    if (accessToken) {
        config.headers.Authorization = `Bearer ${accessToken}`;
    }

    return config;
});

export default questionAxios;
