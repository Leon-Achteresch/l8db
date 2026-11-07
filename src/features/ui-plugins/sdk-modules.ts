import * as React from "react";
import * as runtime from "react/jsx-runtime";
import {
  asDate,
  asNumber,
  asText,
  daysFromToday,
  definePlugin,
  formatDate,
  formatNumber,
} from "../../../packages/ui-plugin-api/src/helpers";
import { createPluginModules } from "../../../packages/ui-plugin-api/src/modules";
import { Badge } from "./sdk/badge";
import { Bar } from "./sdk/bar";
import { Board } from "./sdk/board";
import { Card } from "./sdk/card";
import { Check } from "./sdk/check";
import { Columns } from "./sdk/columns";
import { Empty } from "./sdk/empty";
import { List } from "./sdk/list";
import { Pill } from "./sdk/pill";
import { RelativeTime } from "./sdk/relative-time";
import { SdkButton } from "./sdk/sdk-button";
import { Stack } from "./sdk/stack";
import { Text } from "./sdk/text";

export const UI_PLUGIN_MODULES = createPluginModules(React, runtime, {
  definePlugin,
  Pill,
  Badge,
  Check,
  RelativeTime,
  Text,
  Stack,
  Button: SdkButton,
  Card,
  Columns,
  Bar,
  List,
  Board,
  Empty,
  asText,
  asNumber,
  asDate,
  daysFromToday,
  formatNumber,
  formatDate,
});
