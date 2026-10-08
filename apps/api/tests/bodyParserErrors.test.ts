import request from 'supertest';
import type { NextFunction, Request, Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import app from '../src/app';
import { errorHandler } from '../src/middlewares/errorHandler';

// express.json() rejects a bad body with an http-errors error that already
// carries the right status (400, 413, 415). The global error handler used to
// ignore it and answer 500 "Error interno del servidor", logging a stack trace
// as if the client's mistake were a server bug.
//
// The parser runs before authenticate, so a public route is enough to test it.
describe('request body errors', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const postLogin = () =>
    request(app).post('/api/auth/login').set('Content-Type', 'application/json');

  it('malformed JSON is a 400, not a 500', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await postLogin().send('{"email":');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'El cuerpo de la solicitud no es JSON válido' });
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('a body over the size limit is a 413', async () => {
    // express.json() defaults to a 100 kB limit.
    const huge = JSON.stringify({ email: 'a'.repeat(200_000) });

    const res = await postLogin().send(huge);

    expect(res.status).toBe(413);
    expect(res.body).toEqual({ error: 'El cuerpo de la solicitud es demasiado grande' });
  });

  it('keeps the status of other client errors from the parser (415)', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json; charset=latin1')
      .send('{}');

    expect(res.status).toBe(415);
    expect(res.body).toEqual({ error: 'Solicitud inválida' });
  });

  it('never echoes the raw body back', async () => {
    const res = await postLogin().send('{"password":"hunter2"');

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toContain('hunter2');
  });
});

// An error that does not declare itself safe to expose stays a generic 500,
// whatever its message says.
describe('errorHandler fallback', () => {
  it('answers 500 without leaking the message of an unexpected error', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    const res = { status } as unknown as Response;

    errorHandler(
      new Error('connection string postgres://secret'),
      {} as Request,
      res,
      vi.fn() as NextFunction,
    );

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({ error: 'Error interno del servidor' });
  });
});
