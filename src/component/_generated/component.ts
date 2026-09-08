/* eslint-disable */
/**
 * Generated `ComponentApi` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type { FunctionReference } from "convex/server";

/**
 * A utility for referencing a Convex component's exposed API.
 *
 * Useful when expecting a parameter like `components.myComponent`.
 * Usage:
 * ```ts
 * async function myFunction(ctx: QueryCtx, component: ComponentApi) {
 *   return ctx.runQuery(component.someFile.someQuery, { ...args });
 * }
 * ```
 */
export type ComponentApi<Name extends string | undefined = string | undefined> =
  {
    callbacks: {
      redrive: FunctionReference<
        "mutation",
        "internal",
        { id: string; scope: string },
        boolean,
        Name
      >;
    };
    configuration: {
      getNumber: FunctionReference<
        "query",
        "internal",
        { externalId: string; scope: string },
        null | {
          _creationTime: number;
          _id: string;
          externalId: string;
          messagingProfileId: string;
          phoneNumber?: string;
          scope: string;
          updatedAt: number;
        },
        Name
      >;
      getProfile: FunctionReference<
        "query",
        "internal",
        { externalId: string; scope: string },
        null | {
          _creationTime: number;
          _id: string;
          externalId: string;
          scope: string;
          updatedAt: number;
          webhookFailoverUrl?: string;
          webhookUrl: string;
        },
        Name
      >;
      saveNumber: FunctionReference<
        "mutation",
        "internal",
        {
          externalId: string;
          messagingProfileId: string;
          phoneNumber?: string;
          scope: string;
        },
        null,
        Name
      >;
      saveProfile: FunctionReference<
        "mutation",
        "internal",
        {
          externalId: string;
          scope: string;
          webhookFailoverUrl?: string;
          webhookUrl: string;
        },
        null,
        Name
      >;
    };
    events: {
      ingest: FunctionReference<
        "mutation",
        "internal",
        {
          event: { id: string; occurredAt: number; payload: any; type: string };
          handler?: string;
          scope: string;
        },
        { duplicate: boolean; id: string },
        Name
      >;
      list: FunctionReference<
        "query",
        "internal",
        {
          paginationOpts: {
            cursor: string | null;
            endCursor?: string | null;
            id?: number;
            maximumBytesRead?: number;
            maximumRowsRead?: number;
            numItems: number;
          };
          resourceId?: string;
          scope: string;
        },
        {
          continueCursor: string;
          isDone: boolean;
          page: Array<{
            _creationTime: number;
            _id: string;
            error?: string;
            externalId: string;
            handler?: string;
            occurredAt: number;
            payload: any;
            receivedAt: number;
            resourceId?: string;
            scope: string;
            status: "stored" | "pending" | "delivered" | "failed";
            type: string;
          }>;
        },
        Name
      >;
      redrive: FunctionReference<
        "mutation",
        "internal",
        { id: string; scope: string },
        boolean,
        Name
      >;
    };
    maintenance: {
      redact: FunctionReference<
        "mutation",
        "internal",
        {
          eventIds?: Array<string>;
          operationIds?: Array<string>;
          resourceIds?: Array<string>;
          scope: string;
        },
        number,
        Name
      >;
    };
    messages: {
      backfillIndexes: FunctionReference<
        "mutation",
        "internal",
        {
          paginationOpts: {
            cursor: string | null;
            endCursor?: string | null;
            id?: number;
            maximumBytesRead?: number;
            maximumRowsRead?: number;
            numItems: number;
          };
          scope: string;
        },
        { continueCursor: string; isDone: boolean; processed: number },
        Name
      >;
      listByAddress: FunctionReference<
        "query",
        "internal",
        {
          address: string;
          paginationOpts: {
            cursor: string | null;
            endCursor?: string | null;
            id?: number;
            maximumBytesRead?: number;
            maximumRowsRead?: number;
            numItems: number;
          };
          role: "from" | "to" | "counterparty";
          scope: string;
        },
        {
          continueCursor: string;
          isDone: boolean;
          page: Array<{
            _creationTime: number;
            _id: string;
            data: any;
            direction?: "inbound" | "outbound";
            externalId: string;
            from?: string;
            kind: "message" | "call" | "verification";
            scope: string;
            status: string;
            statusAt: number;
            to?: Array<string>;
            updatedAt: number;
          }>;
        },
        Name
      >;
      listByDirection: FunctionReference<
        "query",
        "internal",
        {
          direction: "inbound" | "outbound";
          paginationOpts: {
            cursor: string | null;
            endCursor?: string | null;
            id?: number;
            maximumBytesRead?: number;
            maximumRowsRead?: number;
            numItems: number;
          };
          scope: string;
        },
        {
          continueCursor: string;
          isDone: boolean;
          page: Array<{
            _creationTime: number;
            _id: string;
            data: any;
            direction?: "inbound" | "outbound";
            externalId: string;
            from?: string;
            kind: "message" | "call" | "verification";
            scope: string;
            status: string;
            statusAt: number;
            to?: Array<string>;
            updatedAt: number;
          }>;
        },
        Name
      >;
    };
    operations: {
      cancel: FunctionReference<
        "mutation",
        "internal",
        { id: string; scope: string },
        boolean,
        Name
      >;
      enqueue: FunctionReference<
        "mutation",
        "internal",
        {
          callback?: string;
          immediate?: boolean;
          key: string;
          method: string;
          request: any;
          runAt?: number;
          scope: string;
          target?: string;
        },
        string,
        Name
      >;
      get: FunctionReference<
        "query",
        "internal",
        { id: string; scope: string },
        null | {
          _creationTime: number;
          _id: string;
          attempts: number;
          callback?: string;
          callbackError?: string;
          callbackStatus?: "pending" | "delivered" | "failed";
          callbackWorkId?: string;
          createdAt: number;
          error?: { message: string; status?: number };
          fingerprint: string;
          immediate?: boolean;
          key: string;
          method: string;
          request: any;
          resourceId?: string;
          result?: any;
          runAt?: number;
          scope: string;
          status:
            | "queued"
            | "running"
            | "succeeded"
            | "failed"
            | "uncertain"
            | "canceled";
          target?: string;
          updatedAt: number;
          workId?: string;
        },
        Name
      >;
      list: FunctionReference<
        "query",
        "internal",
        {
          paginationOpts: {
            cursor: string | null;
            endCursor?: string | null;
            id?: number;
            maximumBytesRead?: number;
            maximumRowsRead?: number;
            numItems: number;
          };
          scope: string;
          status?:
            | "queued"
            | "running"
            | "succeeded"
            | "failed"
            | "uncertain"
            | "canceled";
        },
        {
          continueCursor: string;
          isDone: boolean;
          page: Array<{
            _creationTime: number;
            _id: string;
            attempts: number;
            callback?: string;
            callbackError?: string;
            callbackStatus?: "pending" | "delivered" | "failed";
            callbackWorkId?: string;
            createdAt: number;
            error?: { message: string; status?: number };
            fingerprint: string;
            immediate?: boolean;
            key: string;
            method: string;
            request: any;
            resourceId?: string;
            result?: any;
            runAt?: number;
            scope: string;
            status:
              | "queued"
              | "running"
              | "succeeded"
              | "failed"
              | "uncertain"
              | "canceled";
            target?: string;
            updatedAt: number;
            workId?: string;
          }>;
        },
        Name
      >;
    };
    resources: {
      get: FunctionReference<
        "query",
        "internal",
        {
          externalId: string;
          kind: "message" | "call" | "verification";
          scope: string;
        },
        null | {
          _creationTime: number;
          _id: string;
          data: any;
          direction?: "inbound" | "outbound";
          externalId: string;
          from?: string;
          kind: "message" | "call" | "verification";
          scope: string;
          status: string;
          statusAt: number;
          to?: Array<string>;
          updatedAt: number;
        },
        Name
      >;
      list: FunctionReference<
        "query",
        "internal",
        {
          kind: "message" | "call" | "verification";
          paginationOpts: {
            cursor: string | null;
            endCursor?: string | null;
            id?: number;
            maximumBytesRead?: number;
            maximumRowsRead?: number;
            numItems: number;
          };
          scope: string;
        },
        {
          continueCursor: string;
          isDone: boolean;
          page: Array<{
            _creationTime: number;
            _id: string;
            data: any;
            direction?: "inbound" | "outbound";
            externalId: string;
            from?: string;
            kind: "message" | "call" | "verification";
            scope: string;
            status: string;
            statusAt: number;
            to?: Array<string>;
            updatedAt: number;
          }>;
        },
        Name
      >;
      sync: FunctionReference<
        "mutation",
        "internal",
        {
          at: number;
          data: any;
          externalId: string;
          kind: "message" | "call" | "verification";
          scope: string;
          status?: string;
        },
        null,
        Name
      >;
    };
    worker: {
      sendNow: FunctionReference<
        "action",
        "internal",
        { id: string; scope: string },
        {
          _creationTime: number;
          _id: string;
          attempts: number;
          callback?: string;
          callbackError?: string;
          callbackStatus?: "pending" | "delivered" | "failed";
          callbackWorkId?: string;
          createdAt: number;
          error?: { message: string; status?: number };
          fingerprint: string;
          immediate?: boolean;
          key: string;
          method: string;
          request: any;
          resourceId?: string;
          result?: any;
          runAt?: number;
          scope: string;
          status:
            | "queued"
            | "running"
            | "succeeded"
            | "failed"
            | "uncertain"
            | "canceled";
          target?: string;
          updatedAt: number;
          workId?: string;
        },
        Name
      >;
    };
  };
